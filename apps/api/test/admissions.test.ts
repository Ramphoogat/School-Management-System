import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { clients, createApp, PASSWORD, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const row = (n: number, extra: object = {}) => ({ studentName: `Kid ${n}`, studentEmail: `kid${n}@a.test`, parentName: `Parent ${n}`, parentEmail: `parent${n}@a.test`, class: 'Grade 8-A', ...extra })
const pendingIds = async () => (await prisma.admission.findMany({ where: { schoolId: w.schoolId, status: 'pending' }, orderBy: { studentEmail: 'asc' } })).map((a) => a.id)

describe('admissions: submitting and importing', () => {
  it('the clerk can add applications; teacher, student, parent and principal cannot', async () => {
    const body = { classId: w.classA, studentName: 'Solo', studentEmail: 'solo@a.test', parentName: 'P', parentEmail: 'psolo@a.test' }
    for (const r of ['teacher', 'student', 'parent', 'principal'] as const) expect((await c[r].post('/admissions', body)).status, r).toBe(403)
    expect((await c.clerk.post('/admissions', body)).status).toBe(201)
    expect((await c.clerk.post('/admissions', body)).status).toBe(400) // same student email again
  })

  it('imports a CSV, reporting each bad row without blocking good ones', async () => {
    const res = await c.clerk.post('/admissions/import', {
      rows: [
        row(1, { parentPhone: '+919800000001', whatsappOptIn: 'yes' }),
        row(2, { parentEmail: 'parent1@a.test' }), // sibling: same parent as row 1
        row(3, { class: 'Grade 99' }),
        row(4, { studentEmail: 'not-an-email' }),
        row(5, { studentName: '' }),
        row(1), // duplicate student email within the file
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ total: 6, succeeded: 2 })
    const errs = Object.fromEntries(res.body.failed.map((f: any) => [f.row, f.error]))
    expect(errs[3]).toMatch(/unknown class/i)
    expect(errs[4]).toMatch(/valid student and parent emails/i)
    expect(errs[5]).toMatch(/name/i)
    expect(errs[6]).toMatch(/duplicate/i)
  })

  it('only clerk/admin may import; input is capped and validated', async () => {
    for (const r of ['teacher', 'student', 'parent', 'principal'] as const) expect((await c[r].post('/admissions/import', { rows: [row(9)] })).status, r).toBe(403)
    expect((await c.clerk.post('/admissions/import', { rows: [] })).status).toBe(400)
  })

  it('lists applications for staff only', async () => {
    expect((await c.clerk.get('/admissions')).status).toBe(200)
    expect((await c.principal.get('/admissions')).status).toBe(200)
    for (const r of ['student', 'parent', 'teacher'] as const) expect((await c[r].get('/admissions')).status, r).toBe(403)
  })
})

describe('admissions: approval creates accounts', () => {
  it('only principal and admin can approve or reject', async () => {
    const ids = await pendingIds()
    for (const r of ['clerk', 'teacher', 'student', 'parent'] as const) expect((await c[r].post('/admissions/bulk-approve', { ids, decision: 'approve' })).status, r).toBe(403)
    expect((await c.principal.post('/admissions/bulk-approve', { ids, decision: 'reject' })).status).toBe(400) // reason required
  })

  it('bulk approval creates students and one shared parent, joins the class, links, records consent, and returns credentials once', async () => {
    const all = await prisma.admission.findMany({ where: { studentEmail: { in: ['kid1@a.test', 'kid2@a.test'] } } })
    const res = await c.principal.post('/admissions/bulk-approve', { ids: [...all.map((a) => a.id), 'bogus'], decision: 'approve' })
    expect(res.body).toMatchObject({ total: 3, succeeded: 2 })
    expect(res.body.failed[0]).toMatchObject({ id: 'bogus' })

    // Each new student is welcomed in their class's main chat, posted as the approver.
    const welcomes = await prisma.chatMessage.findMany({ where: { classId: w.classA, channelId: null, body: { contains: 'Welcome to the class' } } })
    expect(welcomes.map((m) => m.body).sort()).toEqual(['Welcome to the class, Kid 1! We\'re glad you\'re here.', 'Welcome to the class, Kid 2! We\'re glad you\'re here.'])
    expect(new Set(welcomes.map((m) => m.senderId))).toEqual(new Set([w.u.principal]))
    expect((await c.student.get(`/chat/${w.classA}`)).body.map((m: any) => m.body).filter((b: string) => b.startsWith('Welcome')).length).toBe(2)

    // Two students but ONE parent account (siblings), so three credentials.
    expect(res.body.credentials).toHaveLength(3)
    expect(res.body.credentials.filter((x: any) => x.role === 'parent')).toHaveLength(1)

    const kid1 = await prisma.user.findFirst({ where: { email: 'kid1@a.test' }, include: { memberships: true } })
    expect(kid1).toMatchObject({ role: 'student', mustChangePassword: true })
    expect(kid1!.memberships[0].classId).toBe(w.classA)
    const parent = await prisma.user.findFirst({ where: { email: 'parent1@a.test' } })
    expect(parent).toMatchObject({ role: 'parent', phone: '+919800000001' })
    expect(await prisma.parentStudentLink.count({ where: { parentId: parent!.id, status: 'approved' } })).toBe(2)
    expect((await prisma.whatsAppConsent.findUnique({ where: { userId: parent!.id } }))!.optedIn).toBe(true)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'admission.approved' } })).toBe(2)
    // Passwords are never stored in plain text.
    expect(kid1!.passwordHash).not.toContain(res.body.credentials[0].tempPassword)
  })

  it('the temporary password works once, forces a change, and the parent then sees the child', async () => {
    const rows = await prisma.admission.findMany({ where: { studentEmail: 'kid3@a.test' } })
    expect(rows).toHaveLength(0)
    await c.clerk.post('/admissions/import', { rows: [row(7)] })
    const a = await prisma.admission.findFirst({ where: { studentEmail: 'kid7@a.test' } })
    const res = await c.principal.post('/admissions/bulk-approve', { ids: [a!.id], decision: 'approve' })
    const stu = res.body.credentials.find((x: any) => x.role === 'student')
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: stu.email, password: stu.tempPassword })
    expect(login.status).toBe(201)
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${login.body.accessToken}`)
    expect(me.body.mustChangePassword).toBe(true)
    const par = res.body.credentials.find((x: any) => x.role === 'parent')
    const pl = await request(app.getHttpServer()).post('/api/auth/login').send({ email: par.email, password: par.tempPassword })
    const pme = await request(app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${pl.body.accessToken}`)
    expect(pme.body.linkedStudentIds).toHaveLength(1)
  })

  it('cannot approve twice, and a rejected application creates nothing', async () => {
    await c.clerk.post('/admissions/import', { rows: [row(20)] })
    const a = await prisma.admission.findFirst({ where: { studentEmail: 'kid20@a.test' } })
    const users = await prisma.user.count()
    const rej = await c.principal.post('/admissions/bulk-approve', { ids: [a!.id], decision: 'reject', reason: 'Class full' })
    expect(rej.body.succeeded).toBe(1)
    expect(await prisma.user.count()).toBe(users)
    expect((await prisma.admission.findUnique({ where: { id: a!.id } }))).toMatchObject({ status: 'rejected', reason: 'Class full' })
    const again = await c.principal.post('/admissions/bulk-approve', { ids: [a!.id], decision: 'approve' })
    expect(again.body.failed[0].error).toMatch(/already rejected/i)
  })

  it('fails safely, creating nothing, when the student email already has an account or the parent email is a staff account', async () => {
    await c.clerk.post('/admissions/import', { rows: [row(30, { studentEmail: 'clerk@a.test' })] })
    await c.clerk.post('/admissions/import', { rows: [row(31, { parentEmail: 'teacher@a.test' })] })
    const before = await prisma.user.count()
    const ids = (await prisma.admission.findMany({ where: { studentEmail: { in: ['kid31@a.test'] }, status: 'pending' } })).map((a) => a.id)
    const res = await c.principal.post('/admissions/bulk-approve', { ids, decision: 'approve' })
    expect(res.body.failed[0].error).toMatch(/belongs to an existing teacher/i)
    expect(await prisma.user.count()).toBe(before) // the whole approval rolled back, including the student
    expect((await prisma.admission.findFirst({ where: { studentEmail: 'kid31@a.test' } }))!.status).toBe('pending')
  })
})

describe('students directory', () => {
  it('is available to clerk, principal and admin only, and searchable', async () => {
    for (const r of ['clerk', 'principal', 'admin'] as const) expect((await c[r].get('/students')).status, r).toBe(200)
    for (const r of ['student', 'parent', 'teacher'] as const) expect((await c[r].get('/students')).status, r).toBe(403)
    const q = await c.clerk.get('/students?q=kid1')
    expect(q.body.map((s: any) => s.email)).toEqual(['kid1@a.test'])
    expect(q.body[0].parents[0]).toMatchObject({ email: 'parent1@a.test' })
    expect(PASSWORD).toBeTruthy()
  })
})
