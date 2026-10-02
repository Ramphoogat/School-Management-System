import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { client, clients, createApp, login, PASSWORD, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const http = () => request(app.getHttpServer())

describe('auth', () => {
  it('logs in with correct credentials and returns both tokens', async () => {
    const res = await http().post('/api/auth/login').send({ email: 'teacher@a.test', password: PASSWORD })
    expect(res.status).toBe(201)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.refreshToken).toBeTruthy()
  })

  it('rejects a wrong password and an unknown email with the same 401', async () => {
    const bad = await http().post('/api/auth/login').send({ email: 'teacher@a.test', password: 'nope-nope' })
    const unknown = await http().post('/api/auth/login').send({ email: 'ghost@a.test', password: PASSWORD })
    expect(bad.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(bad.body.message).toBe(unknown.body.message)
  })

  it('rejects malformed login bodies', async () => {
    expect((await http().post('/api/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(400)
    expect((await http().post('/api/auth/login').send({})).status).toBe(400)
  })

  it('requires a token for protected routes and rejects garbage tokens', async () => {
    expect((await http().get('/api/auth/me')).status).toBe(401)
    expect((await http().get('/api/auth/me').set('authorization', 'Bearer junk')).status).toBe(401)
    expect((await http().get('/api/classes')).status).toBe(401)
  })

  it('returns the current user with role and scope loaded from the database', async () => {
    const c = await clients(app)
    const me = await c.parent.get('/auth/me')
    expect(me.body.role).toBe('parent')
    expect(me.body.linkedStudentIds).toEqual([w.u.student])
    const t = await c.teacher.get('/auth/me')
    expect(t.body.classIds).toEqual([w.classA])
  })

  it('does not accept a refresh token as an access token, or the reverse', async () => {
    const r = await http().post('/api/auth/login').send({ email: 'clerk@a.test', password: PASSWORD })
    expect((await http().get('/api/auth/me').set('authorization', `Bearer ${r.body.refreshToken}`)).status).toBe(401)
    expect((await http().post('/api/auth/refresh').send({ refreshToken: r.body.accessToken })).status).toBe(401)
  })

  it('issues new tokens from a valid refresh token', async () => {
    const r = await http().post('/api/auth/login').send({ email: 'clerk@a.test', password: PASSWORD })
    const res = await http().post('/api/auth/refresh').send({ refreshToken: r.body.refreshToken })
    expect(res.status).toBe(201)
    expect((await client(app, res.body.accessToken).get('/auth/me')).status).toBe(200)
  })

  it('applies a role change to an existing token immediately', async () => {
    const token = await login(app, 'student2@a.test')
    const c = client(app, token)
    expect((await c.get('/role-requests')).status).toBe(403)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'principal' } })
    expect((await c.get('/role-requests')).status).toBe(200)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'student' } })
    expect((await c.get('/role-requests')).status).toBe(403)
  })

  it('cuts off a deactivated user immediately, even with a valid token', async () => {
    const token = await login(app, 'student2@a.test')
    expect((await client(app, token).get('/auth/me')).status).toBe(200)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: false } })
    expect((await client(app, token).get('/auth/me')).status).toBe(401)
    expect((await http().post('/api/auth/login').send({ email: 'student2@a.test', password: PASSWORD })).status).toBe(401)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: true } })
  })

  it('changes a password only with the correct current one, and the old one stops working', async () => {
    const c = client(app, await login(app, 'student2@a.test'))
    expect((await c.post('/auth/change-password', { currentPassword: 'wrong-pass', newPassword: 'brandnew123' })).status).toBe(401)
    expect((await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400)
    expect((await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brandnew123' })).status).toBe(201)
    expect((await http().post('/api/auth/login').send({ email: 'student2@a.test', password: PASSWORD })).status).toBe(401)
    expect((await http().post('/api/auth/login').send({ email: 'student2@a.test', password: 'brandnew123' })).status).toBe(201)
  })

  it('clears the must-change-password flag after a change', async () => {
    await prisma.user.update({ where: { id: w.u.student }, data: { mustChangePassword: true } })
    const c = client(app, await login(app, 'student@a.test'))
    expect((await c.get('/auth/me')).body.mustChangePassword).toBe(true)
    const changed = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another-pass1' })
    expect((await c.get('/auth/me')).status).toBe(401) // the old token is replaced by the one in the reply
    expect((await client(app, changed.body.accessToken).get('/auth/me')).body.mustChangePassword).toBe(false)
  })
})
