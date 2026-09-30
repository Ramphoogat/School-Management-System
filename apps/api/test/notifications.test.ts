import { INestApplication } from '@nestjs/common'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NotificationsService } from '@dist/notifications/notifications.module'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

// The senders are replaced with fakes so delivery, retry and fallback can be tested without a real provider.
const senders = createRequire(import.meta.url)(resolve(process.cwd(), process.env.TEST_DIST_DIR ?? 'dist-test', 'notifications/senders.js'))
const real = { sendEmail: senders.sendEmail, sendWhatsApp: senders.sendWhatsApp }
const NotConfigured = senders.NotConfiguredError

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>
let svc: NotificationsService
let sentEmails: { to: string; subject: string }[]
let sentWhatsApp: { to: string; message: string }[]

beforeAll(async () => {
  app = await createApp()
  svc = app.get(NotificationsService)
})
afterAll(async () => { senders.sendEmail = real.sendEmail; senders.sendWhatsApp = real.sendWhatsApp; await app.close(); await prisma.$disconnect() })

beforeEach(async () => {
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
  sentEmails = []; sentWhatsApp = []
  senders.sendEmail = async (to: string, subject: string) => { sentEmails.push({ to, subject }) }
  senders.sendWhatsApp = async (to: string, message: string) => { sentWhatsApp.push({ to, message }) }
})
afterEach(() => { senders.sendEmail = real.sendEmail; senders.sendWhatsApp = real.sendWhatsApp })

const announce = (channels: string[], title = 'Notice') => c.teacher.post('/announcements', { classId: w.classA, title, body: 'Body text', channels })
const optIn = (userId: string, phone = '+919800000000') =>
  Promise.all([prisma.user.update({ where: { id: userId }, data: { phone } }), prisma.whatsAppConsent.create({ data: { userId, optedIn: true } })])
const rows = (where: object = {}) => prisma.notification.findMany({ where: { event: 'announcement.posted', ...where } })

describe('notifications: who is contacted, and how', () => {
  it('queues email for every recipient, in-app as already delivered, and never contacts the sender', async () => {
    await announce(['email', 'in_app'])
    const email = await rows({ channel: 'email' })
    expect(email.map((r) => r.userId).sort()).toEqual([w.u.student, w.u.student2, w.u.parent].sort())
    expect(email.every((r) => r.status === 'queued')).toBe(true)
    const inApp = await rows({ channel: 'in_app' })
    expect(inApp.every((r) => r.status === 'delivered')).toBe(true)
    expect([...email, ...inApp].some((r) => r.userId === w.u.teacher)).toBe(false)
  })

  it('WhatsApp needs both a phone number and opt-in consent', async () => {
    await announce(['whatsapp'])
    expect(await rows({ channel: 'whatsapp' })).toHaveLength(0)
    await prisma.user.update({ where: { id: w.u.parent }, data: { phone: '+919811111111' } }) // phone without consent
    await announce(['whatsapp'], 'Second')
    expect(await rows({ channel: 'whatsapp' })).toHaveLength(0)
    await prisma.whatsAppConsent.create({ data: { userId: w.u.parent, optedIn: true } })
    await announce(['whatsapp'], 'Third')
    expect((await rows({ channel: 'whatsapp' })).map((r) => r.userId)).toEqual([w.u.parent])
  })

  it('a withdrawn consent stops WhatsApp again', async () => {
    await optIn(w.u.parent)
    await prisma.whatsAppConsent.update({ where: { userId: w.u.parent }, data: { optedIn: false } })
    await announce(['whatsapp'])
    expect(await rows({ channel: 'whatsapp' })).toHaveLength(0)
  })

  it("respects each recipient's channel preferences", async () => {
    expect((await c.student.put('/notifications/preferences', { channel: 'email', enabled: false })).status).toBe(200)
    expect((await c.student.put('/notifications/preferences', { channel: 'in_app', enabled: false })).status).toBe(200)
    await announce(['email', 'in_app'])
    expect((await rows({ userId: w.u.student }))).toHaveLength(0)
    expect((await rows({ userId: w.u.student2 })).length).toBe(2)
    const prefs = await c.student.get('/notifications/preferences')
    expect(prefs.body.channels).toMatchObject({ email: false, in_app: false, whatsapp: true })
    await c.student.put('/notifications/preferences', { channel: 'email', enabled: true })
    expect((await c.student.get('/notifications/preferences')).body.channels.email).toBe(true)
  })

  it('validates preference and profile input', async () => {
    expect((await c.student.put('/notifications/preferences', { channel: 'pigeon', enabled: true })).status).toBe(400)
    expect((await c.student.put('/notifications/preferences', { channel: 'email', enabled: 'yes' })).status).toBe(400)
    expect((await c.parent.put('/notifications/profile', { phone: 'call me maybe' })).status).toBe(400)
    expect((await c.parent.put('/notifications/profile', { phone: '+91 98765 43210', whatsappOptIn: true })).status).toBe(200)
    const p = await c.parent.get('/notifications/preferences')
    expect(p.body).toMatchObject({ phone: '+91 98765 43210', whatsappOptIn: true })
  })

  it('in-app inbox is private to each user and can be marked read', async () => {
    await announce(['in_app'])
    const mine = (await c.student.get('/notifications')).body
    expect(mine).toHaveLength(1)
    expect(mine.every((n: any) => n.userId === w.u.student)).toBe(true)
    expect((await c.teacher.get('/notifications')).body).toEqual([])
    await c.student.post(`/notifications/${mine[0].id}/read`)
    expect((await c.student.get('/notifications')).body[0].readAt).toBeTruthy()
    // Another user cannot mark it read.
    await c.student2.post(`/notifications/${mine[0].id}/read`)
    expect((await prisma.notification.findUnique({ where: { id: mine[0].id } }))!.readAt).toBeTruthy()
    const other = (await c.student2.get('/notifications')).body[0]
    await c.student.post(`/notifications/${other.id}/read`)
    expect((await prisma.notification.findUnique({ where: { id: other.id } }))!.readAt).toBeNull()
  })
})

describe('notifications: delivery worker', () => {
  it('sends queued email and marks it sent', async () => {
    await announce(['email'])
    await svc.processQueue()
    expect(sentEmails.map((e) => e.to).sort()).toEqual(['parent@a.test', 'student2@a.test', 'student@a.test'])
    const r = await rows({ channel: 'email' })
    expect(r.every((x) => x.status === 'sent' && x.attempts === 1 && x.sentAt)).toBe(true)
    await svc.processQueue()
    expect(sentEmails).toHaveLength(3) // nothing is sent twice
  })

  it('a temporary failure is retried later with backoff, then marked failed after 3 attempts', async () => {
    senders.sendEmail = async () => { throw new Error('SMTP timeout') }
    await announce(['email'])
    const id = (await rows({ channel: 'email', userId: w.u.student }))[0].id
    await svc.processQueue()
    let n = (await prisma.notification.findUnique({ where: { id } }))!
    expect(n).toMatchObject({ status: 'queued', attempts: 1, error: 'SMTP timeout' })
    expect(n.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000) // backoff, not immediate
    await svc.processQueue()
    expect((await prisma.notification.findUnique({ where: { id } }))!.attempts).toBe(1) // not due yet, not retried

    for (const attempt of [2, 3]) {
      await prisma.notification.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } })
      await svc.processQueue()
      n = (await prisma.notification.findUnique({ where: { id } }))!
      expect(n.attempts).toBe(attempt)
    }
    expect(n.status).toBe('failed')
  })

  it('a missing provider fails at once instead of retrying forever', async () => {
    senders.sendEmail = async () => { throw new NotConfigured('Email is not configured') }
    await announce(['email'])
    await svc.processQueue()
    const r = await rows({ channel: 'email' })
    expect(r.every((x) => x.status === 'failed' && /not configured/i.test(x.error ?? ''))).toBe(true)
  })

  it('a failed WhatsApp message falls back to email exactly once, and says why', async () => {
    senders.sendWhatsApp = async () => { throw new NotConfigured('WhatsApp is not configured') }
    await optIn(w.u.parent)
    await announce(['whatsapp'])
    await svc.processQueue()
    const wa = await rows({ channel: 'whatsapp' })
    expect(wa[0].status).toBe('failed')
    const fallback = await rows({ channel: 'email', userId: w.u.parent })
    expect(fallback).toHaveLength(1)
    expect(fallback[0].body).toContain('Sent by email because WhatsApp delivery failed')
    await svc.processQueue()
    expect(sentEmails.map((e) => e.to)).toEqual(['parent@a.test'])
    expect(await rows({ channel: 'email', userId: w.u.parent })).toHaveLength(1) // no fallback loop
  })

  it('does not double-send when the person already has the same message by email', async () => {
    senders.sendWhatsApp = async () => { throw new NotConfigured('nope') }
    await optIn(w.u.parent)
    await announce(['email', 'whatsapp'])
    await svc.processQueue()
    expect(await rows({ channel: 'email', userId: w.u.parent })).toHaveLength(1)
  })

  it('does not fall back to email if the person turned email off', async () => {
    senders.sendWhatsApp = async () => { throw new NotConfigured('nope') }
    await optIn(w.u.parent)
    await c.parent.put('/notifications/preferences', { channel: 'email', enabled: false })
    await announce(['whatsapp'])
    await svc.processQueue()
    expect(await rows({ channel: 'email', userId: w.u.parent })).toHaveLength(0)
  })

  it('sends WhatsApp to the stored number when it works', async () => {
    await optIn(w.u.parent, '+91 90000 11111')
    await announce(['whatsapp'], 'Sports day')
    await svc.processQueue()
    expect(sentWhatsApp).toHaveLength(1)
    expect(sentWhatsApp[0]).toMatchObject({ to: '+91 90000 11111' })
    expect(sentWhatsApp[0].message).toContain('Sports day')
  })
})

describe('notifications: delivery log', () => {
  it('is visible to admin only and never lists in-app messages', async () => {
    await announce(['email', 'in_app'])
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal'] as const) expect((await c[r].get('/notifications/log')).status, r).toBe(403)
    const log = await c.admin.get('/notifications/log')
    expect(log.status).toBe(200)
    expect(log.body).toHaveLength(3)
    expect(log.body.every((r: any) => r.channel !== 'in_app' && r.to)).toBe(true)
  })

  it('reports which channels the platform can actually deliver on', async () => {
    const ch = await c.student.get('/notifications/channels')
    expect(ch.body).toEqual({ email: false, whatsapp: false, in_app: true })
  })
})
