import { INestApplication } from '@nestjs/common'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PASSWORD, createApp, makeUser, prisma, resetDb, seedWorld, type World } from './helpers'

// Email is replaced with a fake that remembers what was sent, so the link can be read back.
const senders = createRequire(import.meta.url)(resolve(process.cwd(), process.env.TEST_DIST_DIR ?? 'dist-test', 'notifications/senders.js'))
const real = { sendEmail: senders.sendEmail }
let sent: { to: string; subject: string; text: string }[]

let app: INestApplication
let w: World
// The app allows 20 reset requests per hour from one network address, and every test here comes from the same one,
// so keep the total number of requests below that.
beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
})
afterAll(async () => { senders.sendEmail = real.sendEmail; await app.close(); await prisma.$disconnect() })
beforeEach(() => { sent = []; senders.sendEmail = async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }) } })
afterEach(() => { senders.sendEmail = real.sendEmail })

const http = () => request(app.getHttpServer())
const forgot = (email: string, school?: string) => http().post('/api/auth/forgot-password').send({ email, school })
const useLink = (token: string, newPassword = 'a-brand-new-pass-1') => http().post('/api/auth/reset-password').send({ token, newPassword })
const signIn = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password })
/** Waits for the email that is sent after the reply, and returns the secret from its link. */
const tokenFor = async (to: string) => {
  for (let i = 0; i < 50 && !sent.some((m) => m.to === to); i++) await new Promise((r) => setTimeout(r, 20))
  const mail = [...sent].reverse().find((m) => m.to === to)
  expect(mail, `an email to ${to}`).toBeTruthy()
  return mail!.text.match(/reset-password\?token=([\w-]+)/)![1]
}
const person = (name: string) => makeUser(w.schoolId, `${name}@reset.test`, 'student')

describe('asking for a reset link', () => {
  it('gives the same answer for a real and an unknown address, and only emails the real one', async () => {
    const u = await person('known')
    const real = await forgot(u.email)
    const unknown = await forgot('nobody@reset.test')
    expect(real.status).toBe(unknown.status)
    expect(real.body).toEqual(unknown.body)
    await tokenFor(u.email)
    await new Promise((r) => setTimeout(r, 150))
    expect(sent.map((m) => m.to)).toEqual([u.email])
    expect(sent[0].subject).toMatch(/reset your password/i)
    expect(sent[0].text).toMatch(/60 minutes/)
    expect(sent[0].text).not.toMatch(PASSWORD)
  })

  it('stores only a hash of the link secret', async () => {
    const u = await person('hashed')
    await forgot(u.email)
    const token = await tokenFor(u.email)
    const rows = await prisma.passwordReset.findMany({ where: { userId: u.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(token)
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('emails nobody who is deactivated or whose school is suspended', async () => {
    const off = await person('deactivated')
    await prisma.user.update({ where: { id: off.id }, data: { active: false } })
    await forgot(off.email)
    const susp = await person('suspended')
    await prisma.school.update({ where: { id: w.schoolId }, data: { active: false } })
    try { await forgot(susp.email) } finally { await prisma.school.update({ where: { id: w.schoolId }, data: { active: true } }) }
    await new Promise((r) => setTimeout(r, 200))
    expect(sent).toEqual([])
    expect(await prisma.passwordReset.count({ where: { userId: { in: [off.id, susp.id] } } })).toBe(0)
  })

  it('allows 3 requests an hour for one address, then says how long to wait', async () => {
    const u = await person('limited')
    for (let i = 0; i < 3; i++) expect((await forgot(u.email)).status).toBe(201)
    const blocked = await forgot(u.email)
    expect(blocked.status).toBe(429)
    expect(blocked.body.message).toMatch(/try again in \d+ minute/i)
  })

  it('sends a link for each account when one email is used at two schools, unless a school is named', async () => {
    const other = await seedWorld('B')
    const slugA = 'reset-a', slugB = 'reset-b'
    await prisma.school.update({ where: { id: w.schoolId }, data: { slug: slugA } })
    await prisma.school.update({ where: { id: other.schoolId }, data: { slug: slugB } })
    const email = 'shared@reset.test'
    await makeUser(w.schoolId, email, 'student'); await makeUser(other.schoolId, email, 'student')
    await forgot(email, slugB)
    await tokenFor(email)
    await new Promise((r) => setTimeout(r, 100))
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain(`school=${slugB}`)
    sent.length = 0
    await forgot('shared2@reset.test') // an unrelated address does not disturb anything
    await makeUser(w.schoolId, 'shared3@reset.test', 'student'); await makeUser(other.schoolId, 'shared3@reset.test', 'student')
    await forgot('shared3@reset.test')
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
    expect(sent.filter((m) => m.to === 'shared3@reset.test')).toHaveLength(2)
  })
})

describe('using the link', () => {
  it('sets the new password once, signs out every device and clears a temporary-password flag', async () => {
    const u = await person('flow')
    await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } })
    const before = (await signIn(u.email)).body
    await forgot(u.email)
    const token = await tokenFor(u.email)
    expect((await useLink(token)).status).toBe(201)

    expect((await signIn(u.email)).status).toBe(401) // the old password is gone
    const now = await signIn(u.email, 'a-brand-new-pass-1')
    expect(now.status).toBe(201)
    expect((await http().get('/api/auth/me').set('authorization', `Bearer ${before.accessToken}`)).status).toBe(401)
    expect((await http().post('/api/auth/refresh').send({ refreshToken: before.refreshToken })).status).toBe(401)
    expect((await http().get('/api/auth/me').set('authorization', `Bearer ${now.body.accessToken}`)).body.mustChangePassword).toBe(false)

    const again = await useLink(token, 'another-new-pass-2') // a second use of the same link
    expect(again.status).toBe(400)
    expect(again.body.message).toMatch(/not valid any more/i)
    expect((await signIn(u.email, 'another-new-pass-2')).status).toBe(401)
    expect(await prisma.auditLog.count({ where: { action: 'auth.password_reset', resourceId: u.id } })).toBe(1)
  })

  it('only the newest link works', async () => {
    const u = await person('newest')
    await forgot(u.email)
    const first = await tokenFor(u.email)
    sent.length = 0
    await forgot(u.email)
    const second = await tokenFor(u.email)
    expect(second).not.toBe(first)
    expect((await useLink(first)).status).toBe(400)
    expect((await useLink(second)).status).toBe(201)
  })

  it('refuses an expired link, a made-up one, and a weak or over-long new password', async () => {
    const u = await person('expired')
    await forgot(u.email)
    const token = await tokenFor(u.email)
    expect((await useLink('x'.repeat(43))).status).toBe(400)
    expect((await useLink('short')).status).toBe(400)
    expect((await useLink(token, 'short')).status).toBe(400)
    expect((await useLink(token, 'y'.repeat(73))).status).toBe(400)
    await prisma.passwordReset.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await useLink(token)).status).toBe(400)
    expect((await signIn(u.email)).status).toBe(201) // nothing changed
  })

  it('two clicks at the same moment cannot both win', async () => {
    const u = await person('race')
    await forgot(u.email)
    const token = await tokenFor(u.email)
    const [a, b] = await Promise.all([useLink(token, 'race-password-one-1'), useLink(token, 'race-password-two-2')])
    expect([a.status, b.status].sort()).toEqual([201, 400])
  })

  it('a person deactivated after asking cannot use the link', async () => {
    const u = await person('late-off')
    await forgot(u.email)
    const token = await tokenFor(u.email)
    await prisma.user.update({ where: { id: u.id }, data: { active: false } })
    expect((await useLink(token)).status).toBe(400)
  })
})
