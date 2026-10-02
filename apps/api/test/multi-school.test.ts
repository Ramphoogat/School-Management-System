import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PlatformBootstrap } from '@dist/platform/platform.module'
import { PASSWORD, client, clients, createApp, login, makeUser, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World, wb: World
let c: Awaited<ReturnType<typeof clients>>
let sup: Client
let platformId: string

const postAs = (who: Client | null, path: string, body: object) => {
  const r = request(app.getHttpServer()).post(`/api${path}`).send(body)
  return who ? r.set('authorization', `Bearer ${who.token}`) : r
}
const signIn = (email: string, password: string, school?: string) => request(app.getHttpServer()).post('/api/auth/login').send({ email, password, school })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const putLogo = (who: Client, data: Buffer, name = 'logo.png') => request(app.getHttpServer()).put('/api/school/logo').set('authorization', `Bearer ${who.token}`).attach('file', data, name)
const newSchool = (over: Partial<{ name: string; slug: string; adminName: string; adminEmail: string }> = {}) =>
  sup.post('/platform/schools', { name: 'Greenfield Academy', slug: 'greenfield', adminName: 'Gita Rao', adminEmail: 'gita@greenfield.test', ...over })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A'); wb = await seedWorld('B')
  c = await clients(app, 'a')
  const platform = await prisma.school.create({ data: { name: 'Platform', isPlatform: true } })
  platformId = platform.id
  await makeUser(platform.id, 'super@platform.test', 'superadmin')
  sup = client(app, await login(app, 'super@platform.test'))
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('platform: who can manage schools', () => {
  it('only the super admin can list or create schools', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin'] as const) {
      expect((await c[r].get('/platform/schools')).status, r).toBe(403)
      expect((await c[r].post('/platform/schools', { name: 'X School', slug: 'xschool', adminName: 'Ann', adminEmail: 'a@x.test' })).status, r).toBe(403)
    }
    expect((await postAs(null, '/platform/schools', {})).status).toBe(401)
    const list = await sup.get('/platform/schools')
    expect(list.status).toBe(200)
    expect(list.body.map((s: any) => s.name).sort()).toEqual(['School A', 'School B']) // the hidden platform school is never listed
  })

  it('the super admin has no way into a school\'s own records', async () => {
    for (const path of ['/users', '/audit', '/messages/conversations', '/notifications/templates', '/students']) expect((await sup.get(path)).status, path).toBe(403)
    expect((await sup.get('/classes')).body).toEqual([])
    expect((await sup.get('/fees/invoices')).body).toEqual([])
    expect((await sup.get('/announcements')).body).toEqual([])
  })

  it('nobody can make a super admin from inside a school', async () => {
    expect((await c.admin.post('/users', { name: 'Sneaky', email: 'sneaky@a.test', role: 'superadmin' })).status).toBe(400)
    expect((await c.admin.put(`/users/${w.u.teacher}/role`, { role: 'superadmin' })).status).toBe(400)
    expect((await c.teacher.post('/role-requests', { requestedRole: 'superadmin', targetUserId: w.u.teacher, reason: 'please' })).status).toBe(400)
  })
})

describe('platform: creating a school', () => {
  it('validates the address', async () => {
    for (const slug of ['a', '-abc', 'abc-', 'Has Space', 'has_underscore', 'x'.repeat(41)]) expect((await newSchool({ slug })).status, slug).toBe(400)
    for (const slug of ['www', 'admin', 'platform', 'api']) expect((await newSchool({ slug })).status, slug).toBe(400)
    expect((await newSchool({ adminEmail: 'not-an-email' })).status).toBe(400)
    expect(await prisma.school.count({ where: { slug: 'greenfield' } })).toBe(0) // nothing half-created
  })

  it('creates the school and its first admin, who signs in from the school\'s own address', async () => {
    const r = await newSchool()
    expect(r.status).toBe(201)
    expect(r.body.school).toMatchObject({ name: 'Greenfield Academy', slug: 'greenfield', active: true })
    expect(r.body.admin.email).toBe('gita@greenfield.test')
    expect(r.body.tempPassword.length).toBeGreaterThanOrEqual(10)

    const signed = await signIn('gita@greenfield.test', r.body.tempPassword, 'greenfield')
    expect(signed.status).toBe(201)
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${signed.body.accessToken}`)
    expect(me.body).toMatchObject({ role: 'admin', mustChangePassword: true, school: { slug: 'greenfield', name: 'Greenfield Academy' } })
    expect(await prisma.auditLog.count({ where: { action: 'school.created', actorId: (await prisma.user.findFirstOrThrow({ where: { email: 'super@platform.test' } })).id } })).toBe(1)
    expect((await newSchool()).status).toBe(400) // the address is taken
  })

  it('a new school starts empty and cannot see any other school', async () => {
    const admin = client(app, (await signIn('gita@greenfield.test', (await sup.post('/platform/schools/' + (await prisma.school.findFirstOrThrow({ where: { slug: 'greenfield' } })).id + '/admins/' + (await prisma.user.findFirstOrThrow({ where: { email: 'gita@greenfield.test' } })).id + '/reset-password')).body.tempPassword, 'greenfield')).body.accessToken)
    expect((await admin.get('/users')).body.map((u: any) => u.email)).toEqual(['gita@greenfield.test'])
    expect((await admin.get('/classes')).body).toEqual([])
  })
})

describe('signing in is tied to the school', () => {
  it('a school\'s address only accepts that school\'s people', async () => {
    const id = (await prisma.school.findFirstOrThrow({ where: { name: 'School A' } })).id
    expect((await sup.patch(`/platform/schools/${id}`, { slug: 'school-a' })).status).toBe(200)
    expect((await signIn('student@a.test', PASSWORD, 'school-a')).status).toBe(201)
    expect((await signIn('student@a.test', PASSWORD, 'greenfield')).status).toBe(401) // right person, wrong school
    expect((await signIn('student@a.test', PASSWORD, 'no-such-school')).status).toBe(401)
    expect((await signIn('student@a.test', 'wrong-password', 'school-a')).status).toBe(401)
    expect((await signIn('student@a.test', PASSWORD)).status).toBe(201) // no address: fine while the email is unique
  })

  it('the same email can exist at two schools; the password or the address tells them apart', async () => {
    const a = await prisma.school.findFirstOrThrow({ where: { slug: 'school-a' } })
    const g = await prisma.school.findFirstOrThrow({ where: { slug: 'greenfield' } })
    const a1 = await makeUser(a.id, 'twin@mail.test', 'teacher')
    const g1 = await prisma.user.create({ data: { schoolId: g.id, email: 'twin@mail.test', name: 'twin', role: 'teacher', passwordHash: await bcrypt.hash('another-password', 4) } })
    // Different passwords: the one that matches is the one signed into.
    const viaA = await signIn('twin@mail.test', PASSWORD)
    const viaG = await signIn('twin@mail.test', 'another-password')
    expect(viaA.status).toBe(201); expect(viaG.status).toBe(201)
    const who = async (r: request.Response) => (await request(app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${r.body.accessToken}`)).body.school.slug
    expect(await who(viaA)).toBe('school-a'); expect(await who(viaG)).toBe('greenfield')
    // Same password at both: it cannot guess, so it asks for the school's address.
    await prisma.user.update({ where: { id: g1.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } })
    const ambiguous = await signIn('twin@mail.test', PASSWORD)
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body.message).toMatch(/more than one school/)
    expect((await signIn('twin@mail.test', PASSWORD, 'school-a')).status).toBe(201)
    expect((await signIn('twin@mail.test', PASSWORD, 'greenfield')).status).toBe(201)
    await prisma.user.deleteMany({ where: { id: { in: [a1.id, g1.id] } } })
  })

  it('a school\'s admin can add someone who already has an account at another school', async () => {
    expect((await c.admin.post('/users', { name: 'Shared Person', email: 'student@b.test', role: 'parent' })).status).toBe(201)
    expect((await c.admin.post('/users', { name: 'Again', email: 'STUDENT@a.test', role: 'parent' })).status).toBe(400) // duplicate inside the same school
    await prisma.user.deleteMany({ where: { email: 'student@b.test', schoolId: w.schoolId } })
  })
})

describe('suspending a school', () => {
  it('locks out everyone at that school at once, leaves other schools alone, and can be undone', async () => {
    const g = await prisma.school.findFirstOrThrow({ where: { slug: 'greenfield' } })
    const gAdmin = await prisma.user.findFirstOrThrow({ where: { email: 'gita@greenfield.test' } })
    const pw = (await sup.post(`/platform/schools/${g.id}/admins/${gAdmin.id}/reset-password`)).body.tempPassword
    const token = (await signIn('gita@greenfield.test', pw, 'greenfield')).body.accessToken
    const me = () => request(app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${token}`)
    expect((await me()).status).toBe(200)

    expect((await sup.patch(`/platform/schools/${g.id}`, { active: false })).status).toBe(200)
    expect((await me()).status).toBe(401) // an already signed-in session stops working
    expect((await signIn('gita@greenfield.test', pw, 'greenfield')).status).toBe(401)
    expect((await signIn('gita@greenfield.test', pw)).status).toBe(401)
    expect((await request(app.getHttpServer()).get('/api/tenant/greenfield')).status).toBe(404)
    expect((await signIn('student@a.test', PASSWORD, 'school-a')).status).toBe(201) // another school is unaffected
    expect((await sup.get('/platform/schools')).body.find((s: any) => s.slug === 'greenfield').active).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: 'school.suspended', schoolId: g.id } })).toBe(1)

    expect((await sup.patch(`/platform/schools/${g.id}`, { active: true })).status).toBe(200)
    expect((await signIn('gita@greenfield.test', pw, 'greenfield')).status).toBe(201)
    expect(await prisma.auditLog.count({ where: { action: 'school.reactivated', schoolId: g.id } })).toBe(1)
  })

  it('the platform\'s own school cannot be suspended, and unknown schools are not found', async () => {
    expect((await sup.patch(`/platform/schools/${platformId}`, { active: false })).status).toBe(404)
    expect((await sup.patch('/platform/schools/nope', { active: false })).status).toBe(404)
    expect((await sup.patch(`/platform/schools/${w.schoolId}`, {})).status).toBe(400) // nothing to change
    expect((await signIn('super@platform.test', PASSWORD)).status).toBe(201)
  })
})

describe('platform: admins of a school', () => {
  it('adds another admin, resets a password, and only for admins of that school', async () => {
    const g = await prisma.school.findFirstOrThrow({ where: { slug: 'greenfield' } })
    const add = await sup.post(`/platform/schools/${g.id}/admins`, { name: 'Second Admin', email: 'second@greenfield.test' })
    expect(add.status).toBe(201)
    expect((await signIn('second@greenfield.test', add.body.tempPassword, 'greenfield')).status).toBe(201)
    expect((await sup.post(`/platform/schools/${g.id}/admins`, { name: 'Dup', email: 'SECOND@greenfield.test' })).status).toBe(400)
    const detail = await sup.get(`/platform/schools/${g.id}`)
    expect(detail.body.admins.map((a: any) => a.email).sort()).toEqual(['gita@greenfield.test', 'second@greenfield.test'])
    // A teacher of another school cannot have their password reset through here.
    expect((await sup.post(`/platform/schools/${g.id}/admins/${w.u.teacher}/reset-password`)).status).toBe(404)
  })

  it('lists people counts without exposing names or records', async () => {
    const a = (await sup.get('/platform/schools')).body.find((s: any) => s.slug === 'school-a')
    expect(a).toMatchObject({ students: 2, teachers: 2 })
    expect(Object.keys(a)).not.toContain('users')
  })
})

describe('the school page and branding', () => {
  it('shows a school\'s name, tagline and colour to anyone, and nothing else', async () => {
    expect((await c.admin.put('/school/branding', { name: 'School A of Pune', tagline: 'Learning together', brandHue: 150 })).status).toBe(200)
    const pub = await request(app.getHttpServer()).get('/api/tenant/school-a')
    expect(pub.status).toBe(200)
    expect(pub.body).toEqual({ slug: 'school-a', name: 'School A of Pune', tagline: 'Learning together', brandHue: 150, logo: null })
    expect((await request(app.getHttpServer()).get('/api/tenant/nope')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/api/tenant/school-a/logo')).status).toBe(404) // none yet
    const me = (await c.student.get('/auth/me')).body
    expect(me.school).toMatchObject({ name: 'School A of Pune', brandHue: 150 })
  })

  it('only the school\'s admin edits branding, with sensible limits', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal'] as const) expect((await c[r].put('/school/branding', { tagline: 'x' })).status, r).toBe(403)
    expect((await c.admin.put('/school/branding', { brandHue: 400 })).status).toBe(400)
    expect((await c.admin.put('/school/branding', { name: 'A' })).status).toBe(400)
    expect((await c.admin.put('/school/branding', {})).status).toBe(400)
    expect((await c.admin.put('/school/branding', { brandHue: null })).status).toBe(200)
    expect((await c.admin.put('/school/branding', { brandHue: 150 })).status).toBe(200)
    expect((await sup.patch(`/platform/schools/${wb.schoolId}`, { brandHue: 20, tagline: 'Set by the platform' })).status).toBe(200) // the platform can brand any school
  })

  it('uploads a logo that anyone can see on the sign-in page, and only accepts real pictures', async () => {
    expect((await putLogo(c.teacher, PNG)).status).toBe(403)
    expect((await putLogo(c.admin, Buffer.from('MZ not a picture'), 'logo.png')).status).toBe(400)
    expect((await putLogo(c.admin, PNG, 'logo.gif')).status).toBe(400)
    expect((await putLogo(c.admin, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 100 * 1024)]))).status).toBe(413)
    const ok = await putLogo(c.admin, PNG)
    expect(ok.status).toBe(200)
    expect(ok.body.logo).toMatch(/^\/api\/tenant\/school-a\/logo\?v=\d+$/)

    const img = await request(app.getHttpServer()).get('/api/tenant/school-a/logo') // no login
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect(img.headers['x-content-type-options']).toBe('nosniff')
    expect(img.body.length).toBe(PNG.length)
    expect((await request(app.getHttpServer()).get('/api/tenant/school-a')).body.logo).toBeTruthy()

    expect((await c.admin.delete('/school/logo')).status).toBe(200)
    expect((await request(app.getHttpServer()).get('/api/tenant/school-a/logo')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/api/tenant/school-a')).body.logo).toBeNull()
  })
})

describe('creating the super admin at startup', () => {
  const boot = () => new PlatformBootstrap(prisma as never)
  const set = (email?: string, password?: string) => { if (email === undefined) delete process.env.SUPERADMIN_EMAIL; else process.env.SUPERADMIN_EMAIL = email; if (password === undefined) delete process.env.SUPERADMIN_PASSWORD; else process.env.SUPERADMIN_PASSWORD = password }
  afterAll(() => set())

  it('creates one from the settings, only once, and ignores a weak password', async () => {
    set('root@platform.test', 'short')
    await boot().onModuleInit()
    expect(await prisma.user.count({ where: { email: 'root@platform.test' } })).toBe(0)
    set('root@platform.test', 'a-long-enough-password')
    await boot().onModuleInit(); await boot().onModuleInit()
    expect(await prisma.user.count({ where: { email: 'root@platform.test', role: 'superadmin' } })).toBe(1)
    expect(await prisma.school.count({ where: { isPlatform: true } })).toBe(1) // reuses the existing platform school
    expect((await signIn('root@platform.test', 'a-long-enough-password')).status).toBe(201)
    set()
  })
})
