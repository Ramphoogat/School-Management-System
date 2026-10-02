import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FailureLimiter } from '@dist/auth/rate-limit'
import { enforceSecrets, secretProblems } from '@dist/common/security'
import { PASSWORD, createApp, makeUser, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const http = () => request(app.getHttpServer())
const signIn = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password })
const me = (token: string) => http().get('/api/auth/me').set('authorization', `Bearer ${token}`)
const refresh = (refreshToken: string) => http().post('/api/auth/refresh').send({ refreshToken })
const newUser = async (name: string, role: 'student' | 'admin' = 'student') => {
  const u = await makeUser(w.schoolId, `${name}@sec.test`, role)
  return { id: u.id, email: u.email }
}

describe('response headers', () => {
  it('are set on every response, and the server does not announce what it runs on', async () => {
    const r = await http().get('/api/tenant/nothing-here')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(r.headers['x-powered-by']).toBeUndefined()
  })
})

describe('sign-in lockout', () => {
  it('locks one account after 10 wrong passwords, even for the right password, and leaves other accounts alone', async () => {
    const a = await newUser('lock-a'), b = await newUser('lock-b')
    for (let i = 0; i < 10; i++) expect((await signIn(a.email, 'wrong-password')).status).toBe(401)
    const locked = await signIn(a.email)
    expect(locked.status).toBe(429)
    expect(locked.body.message).toMatch(/try again in \d+ minute/i)
    expect((await signIn(b.email)).status).toBe(201)
  })

  it('counts unknown emails the same way, so nobody can tell which addresses exist', async () => {
    for (let i = 0; i < 10; i++) expect((await signIn('nobody-here@sec.test', 'whatever-123')).status).toBe(401)
    expect((await signIn('nobody-here@sec.test', 'whatever-123')).status).toBe(429)
  })

  it('a good sign-in clears the count', async () => {
    const c = await newUser('lock-c')
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 9; i++) await signIn(c.email, 'wrong-password')
      expect((await signIn(c.email)).status, `round ${round}`).toBe(201)
    }
  })

  it('does not count a request that failed for another reason', async () => {
    const d = await newUser('lock-d')
    for (let i = 0; i < 12; i++) expect((await http().post('/api/auth/login').send({ email: d.email })).status).toBe(400) // no password sent
    expect((await signIn(d.email)).status).toBe(201)
  })

  it('refuses over-long input instead of hashing it', async () => {
    const u = await newUser('long-input')
    expect((await signIn(u.email, 'x'.repeat(201))).status).toBe(400)
    expect((await signIn(`${'a'.repeat(250)}@sec.test`)).status).toBe(400)
  })
})

describe('the change-password check cannot be guessed at', () => {
  it('stops after 5 wrong current passwords', async () => {
    const u = await newUser('pw-guess')
    const t = (await signIn(u.email)).body.accessToken
    const change = (cur: string) => http().post('/api/auth/change-password').set('authorization', `Bearer ${t}`).send({ currentPassword: cur, newPassword: 'a-new-password-1' })
    for (let i = 0; i < 5; i++) expect((await change('wrong')).status).toBe(401)
    const blocked = await change(PASSWORD)
    expect(blocked.status).toBe(429)
  })

  it('refuses a new password longer than the hash can use', async () => {
    const u = await newUser('pw-long')
    const t = (await signIn(u.email)).body.accessToken
    const r = await http().post('/api/auth/change-password').set('authorization', `Bearer ${t}`).send({ currentPassword: PASSWORD, newPassword: 'x'.repeat(73) })
    expect(r.status).toBe(400)
  })
})

describe('signing people out', () => {
  it('a password change signs out every other device but not this one', async () => {
    const u = await newUser('rev-pw')
    const first = (await signIn(u.email)).body, second = (await signIn(u.email)).body
    const changed = await http().post('/api/auth/change-password').set('authorization', `Bearer ${first.accessToken}`).send({ currentPassword: PASSWORD, newPassword: 'a-new-password-2' })
    expect(changed.status).toBe(201)
    expect(changed.body.accessToken).toBeTruthy()
    expect((await me(second.accessToken)).status).toBe(401)
    expect((await refresh(second.refreshToken)).status).toBe(401)
    expect((await me(first.accessToken)).status).toBe(401) // the old token of this device is replaced too
    expect((await me(changed.body.accessToken)).status).toBe(200)
    expect((await refresh(changed.body.refreshToken)).status).toBe(201)
    expect((await signIn(u.email, 'a-new-password-2')).status).toBe(201)
  })

  it('"sign out of all devices" kills access and refresh tokens everywhere', async () => {
    const u = await newUser('rev-all')
    const a = (await signIn(u.email)).body, b = (await signIn(u.email)).body
    expect((await http().post('/api/auth/logout-all').set('authorization', `Bearer ${a.accessToken}`)).status).toBe(201)
    for (const t of [a, b]) {
      expect((await me(t.accessToken)).status).toBe(401)
      expect((await refresh(t.refreshToken)).status).toBe(401)
    }
    expect((await signIn(u.email)).status).toBe(201) // signing in again still works
  })

  it('an admin resetting a password signs that person out everywhere', async () => {
    const admin = await newUser('rev-admin', 'admin')
    const target = await newUser('rev-target')
    const adminTok = (await signIn(admin.email)).body.accessToken
    const t = (await signIn(target.email)).body
    const r = await http().post(`/api/users/${target.id}/reset-password`).set('authorization', `Bearer ${adminTok}`).send({})
    expect(r.status).toBeLessThan(300)
    expect((await me(t.accessToken)).status).toBe(401)
    expect((await refresh(t.refreshToken)).status).toBe(401)
  })

  it('deactivating someone ends their refresh tokens too, and reactivating does not bring old ones back', async () => {
    const admin = await newUser('rev-admin2', 'admin')
    const target = await newUser('rev-off')
    const adminTok = (await signIn(admin.email)).body.accessToken
    const t = (await signIn(target.email)).body
    expect((await http().post(`/api/users/${target.id}/deactivate`).set('authorization', `Bearer ${adminTok}`).send({})).status).toBeLessThan(300)
    expect((await refresh(t.refreshToken)).status).toBe(401)
    expect((await signIn(target.email)).status).toBe(401)
    await http().post(`/api/users/${target.id}/reactivate`).set('authorization', `Bearer ${adminTok}`).send({})
    expect((await refresh(t.refreshToken)).status).toBe(401) // the old token stays dead
    expect((await signIn(target.email)).status).toBe(201)
  })

  it('a suspended school cannot refresh either', async () => {
    const u = await newUser('rev-school')
    const t = (await signIn(u.email)).body
    await prisma.school.update({ where: { id: w.schoolId }, data: { active: false } })
    try { expect((await refresh(t.refreshToken)).status).toBe(401) } finally { await prisma.school.update({ where: { id: w.schoolId }, data: { active: true } }) }
    expect((await refresh(t.refreshToken)).status).toBe(201)
  })

  it('tokens made before this feature (no version inside) still work until the first revocation', async () => {
    const u = await newUser('rev-old')
    const { JwtService } = await import('@nestjs/jwt')
    const jwt = new JwtService({})
    const legacy = await jwt.signAsync({ sub: u.id }, { secret: process.env.JWT_SECRET, expiresIn: '15m' })
    expect((await me(legacy)).status).toBe(200)
    await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } })
    expect((await me(legacy)).status).toBe(401)
  })
})

describe('FailureLimiter', () => {
  it('counts inside the window, forgets after it, and clear() resets', () => {
    let now = 0
    const l = new FailureLimiter(3, 10 * 60_000, () => now)
    for (let i = 0; i < 2; i++) l.fail('k')
    expect(l.waitMinutes('k')).toBe(0)
    l.fail('k')
    expect(l.waitMinutes('k')).toBe(10)
    now = 4 * 60_000
    expect(l.waitMinutes('k')).toBe(6)
    expect(() => l.check('k')).toThrow(/try again in 6 minutes/i)
    now = 10 * 60_000
    expect(l.waitMinutes('k')).toBe(0)
    l.fail('k'); l.fail('k'); l.fail('k')
    l.clear('k')
    expect(l.waitMinutes('k')).toBe(0)
    l.fail('other')
    expect(l.waitMinutes('other')).toBe(0)
  })
})

describe('start-up checks on the sign-in secrets', () => {
  const good = { JWT_SECRET: 'q'.repeat(20) + 'Z9x!'.repeat(5), JWT_REFRESH_SECRET: 'r'.repeat(20) + 'K3m#'.repeat(5), WEB_ORIGIN: 'https://school.example.com' }

  it('accepts long, different, non-placeholder secrets and an https address', () => {
    expect(secretProblems(good)).toEqual([])
    expect(secretProblems({ ...good, SUPERADMIN_EMAIL: 'me@example.com', SUPERADMIN_PASSWORD: 'a-long-strong-pass-1' })).toEqual([])
  })

  it('names each problem', () => {
    const joined = (env: Record<string, string>) => secretProblems(env).join(' | ')
    expect(joined({ ...good, JWT_SECRET: '' })).toMatch(/JWT_SECRET is not set/)
    expect(joined({ ...good, JWT_SECRET: 'short' })).toMatch(/JWT_SECRET is too short/)
    expect(joined({ ...good, JWT_SECRET: 'change-me'.padEnd(40, 'x') })).toMatch(/placeholder/)
    expect(joined({ ...good, JWT_REFRESH_SECRET: good.JWT_SECRET })).toMatch(/must be different/)
    expect(joined({ ...good, SUPERADMIN_EMAIL: 'a@b.com', SUPERADMIN_PASSWORD: 'password123' })).toMatch(/SUPERADMIN_PASSWORD/)
    expect(joined({ ...good, WEB_ORIGIN: 'http://localhost:3000' })).toMatch(/WEB_ORIGIN/)
    expect(joined({ ...good, WEB_ORIGIN: 'http://school.example.com' })).toMatch(/WEB_ORIGIN/)
  })

  it('refuses to start in production, only warns elsewhere', () => {
    const bad = { JWT_SECRET: 'change-me', JWT_REFRESH_SECRET: 'change-me-too', WEB_ORIGIN: 'http://localhost:3000' }
    expect(() => enforceSecrets({ ...bad, NODE_ENV: 'production' }, () => undefined)).toThrow(/will not start/)
    const seen: string[] = []
    expect(() => enforceSecrets({ ...bad, NODE_ENV: 'development' }, (m) => seen.push(m))).not.toThrow()
    expect(seen.join('')).toMatch(/Unsafe settings/)
    expect(() => enforceSecrets({ ...good, NODE_ENV: 'production' }, () => undefined)).not.toThrow()
  })
})
