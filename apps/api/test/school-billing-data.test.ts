import { INestApplication } from '@nestjs/common'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import request from 'supertest'
import { Prisma } from '@school/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addMonths, billingStatus } from '@dist/billing/billing.module'
import { CHILD_TABLES, classifyModels } from '@dist/school-data/school-data.module'
import { client, clients, createApp, daysFromNow, login, makeUser, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World, wb: World
let a: Awaited<ReturnType<typeof clients>>
let b: Awaited<ReturnType<typeof clients>>
let sup: Client
let platformId: string

const raw = (method: 'patch' | 'delete', who: Client, path: string, body?: object) => request(app.getHttpServer())[method](`/api${path}`).set('authorization', `Bearer ${who.token}`).send(body ?? {})
const patch = (path: string, body: object) => raw('patch', sup, path, body)
const PDF = Buffer.from('%PDF-1.4\nform')
const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
let n = 0
const newStudent = (who: Client) => who.post('/users', { name: `Kid ${++n}`, email: `kid${n}@a.test`, role: 'student' })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A'); wb = await seedWorld('B')
  a = await clients(app, 'a'); b = await clients(app, 'b')
  const platform = await prisma.school.create({ data: { name: 'Platform', isPlatform: true } })
  platformId = platform.id
  await makeUser(platform.id, 'super@platform.test', 'superadmin')
  sup = client(app, await login(app, 'super@platform.test'))
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('billing status and dates', () => {
  const on = (s: string) => day(s)
  it('works out where a school stands', () => {
    expect(billingStatus(false, null)).toEqual({ status: 'none', daysLeft: null })
    expect(billingStatus(true, null)).toEqual({ status: 'active', daysLeft: null }) // no end date: never runs out
    expect(billingStatus(true, on('2026-06-30'), on('2026-05-01'))).toMatchObject({ status: 'active', daysLeft: 60 })
    expect(billingStatus(true, on('2026-06-30'), on('2026-06-16'))).toMatchObject({ status: 'expiring', daysLeft: 14 })
    expect(billingStatus(true, on('2026-06-30'), on('2026-06-30'))).toMatchObject({ status: 'expiring', daysLeft: 0 }) // the last paid day still counts
    expect(billingStatus(true, on('2026-06-30'), on('2026-07-01'))).toMatchObject({ status: 'grace', daysLeft: -1 })
    expect(billingStatus(true, on('2026-06-30'), on('2026-07-14'))).toMatchObject({ status: 'grace' })
    expect(billingStatus(true, on('2026-06-30'), on('2026-07-15'))).toMatchObject({ status: 'overdue' })
  })

  it('adds months without spilling into the next one', () => {
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    expect(iso(addMonths(on('2026-01-31'), 1))).toBe('2026-02-28')
    expect(iso(addMonths(on('2028-01-31'), 1))).toBe('2028-02-29')
    expect(iso(addMonths(on('2026-11-30'), 3))).toBe('2027-02-28')
    expect(iso(addMonths(on('2026-03-15'), 12))).toBe('2027-03-15')
  })
})

describe('plans', () => {
  it('only the super admin manages plans', async () => {
    const body = { name: 'Small', maxStudents: 3, priceMonthly: 100000 }
    for (const r of ['principal', 'admin', 'teacher'] as const) {
      expect((await a[r].get('/platform/plans')).status, r).toBe(403)
      expect((await a[r].post('/platform/plans', body)).status, r).toBe(403)
    }
    const made = await sup.post('/platform/plans', body)
    expect(made.status).toBe(201)
    expect((await sup.post('/platform/plans', body)).status).toBe(409) // same name
    for (const bad of [{ ...body, name: 'x' }, { ...body, maxStudents: -1 }, { ...body, priceMonthly: 1.5 }, { ...body, name: 'Other', maxStudents: 'many' }]) expect((await sup.post('/platform/plans', bad)).status).toBe(400)
    expect((await sup.post('/platform/plans', { name: 'Unlimited', maxStudents: 0, priceMonthly: 500000 })).status).toBe(201)
    const list = (await sup.get('/platform/plans')).body
    expect(list.map((p: any) => p.name).sort()).toEqual(['Small', 'Unlimited'])
  })

  it('a plan in use cannot be deleted, and a retired plan cannot be given to a school', async () => {
    const small = (await sup.get('/platform/plans')).body.find((p: any) => p.name === 'Small')
    expect((await patch(`/platform/schools/${w.schoolId}`, { planId: small.id })).status).toBe(200)
    expect((await sup.get('/platform/plans')).body.find((p: any) => p.name === 'Small').schools).toBe(1)
    expect((await raw('delete', sup, `/platform/plans/${small.id}`)).status).toBe(409)
    const old = (await sup.post('/platform/plans', { name: 'Old', maxStudents: 5, priceMonthly: 0 })).body
    expect((await patch(`/platform/plans/${old.id}`, { active: false })).status).toBe(200)
    expect((await patch(`/platform/schools/${wb.schoolId}`, { planId: old.id })).status).toBe(400)
    expect((await patch(`/platform/schools/${wb.schoolId}`, { planId: 'nope' })).status).toBe(400)
    expect((await raw('delete', sup, `/platform/plans/${old.id}`)).status).toBe(200)
    expect((await patch(`/platform/plans/${small.id}`, { name: 'Unlimited' })).status).toBe(409)
  })

  it('shows the plan on the school list and detail', async () => {
    const row = (await sup.get('/platform/schools')).body.find((s: any) => s.id === w.schoolId)
    expect(row).toMatchObject({ plan: { name: 'Small', maxStudents: 3 }, billing: 'active', students: 2 })
    const one = (await sup.get(`/platform/schools/${w.schoolId}`)).body
    expect(one.billing).toMatchObject({ plan: { name: 'Small' }, students: 2, status: 'active' })
  })
})

describe('student limits', () => {
  it('a school can fill its plan and no more, whichever way a student is added', async () => {
    // School A is on Small (3 students) and has 2.
    expect((await newStudent(a.admin)).status).toBe(201)
    const over = await newStudent(a.admin)
    expect(over.status).toBe(403)
    expect(over.body.message).toMatch(/allows up to 3 students/)
    // Turning a teacher into a student adds a student too.
    expect((await a.admin.put(`/users/${w.u.teacher2}/role`, { role: 'student' })).status).toBe(403)
    // So does approving an admission.
    const adm = await a.clerk.post('/admissions', { classId: w.classA, studentName: 'New Kid', studentEmail: 'newkid@a.test', parentName: 'P', parentEmail: 'pnew@a.test' })
    expect(adm.status).toBe(201)
    const pending = await prisma.admission.findFirstOrThrow({ where: { studentEmail: 'newkid@a.test' } })
    const res = await a.principal.post('/admissions/bulk-approve', { ids: [pending.id], decision: 'approve' })
    expect(res.body.failed[0].error).toMatch(/allows up to 3 students/)
    expect(await prisma.user.count({ where: { email: 'newkid@a.test' } })).toBe(0)
  })

  it('freeing a place makes room, and bringing a student back needs room too', async () => {
    const added = await prisma.user.findFirstOrThrow({ where: { schoolId: w.schoolId, role: 'student', email: 'kid1@a.test' } })
    expect((await a.admin.post(`/users/${added.id}/deactivate`)).status).toBe(201)
    const second = await newStudent(a.admin)
    expect(second.status).toBe(201)
    expect((await a.admin.post(`/users/${added.id}/reactivate`)).status).toBe(403) // full again
    expect((await a.admin.post(`/users/${second.body.user.id}/deactivate`)).status).toBe(201)
    expect((await a.admin.post(`/users/${added.id}/reactivate`)).status).toBe(201)
  })

  it('does not limit anyone but students, or a school without a plan, or an unlimited plan', async () => {
    expect((await a.admin.post('/users', { name: 'New Teacher', email: 'nt@a.test', role: 'teacher' })).status).toBe(201)
    expect((await b.admin.post('/users', { name: 'B Kid', email: 'bk@b.test', role: 'student' })).status).toBe(201) // B has no plan
    const unl = (await sup.get('/platform/plans')).body.find((p: any) => p.name === 'Unlimited')
    expect((await patch(`/platform/schools/${w.schoolId}`, { planId: unl.id })).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await newStudent(a.admin)).status).toBe(201)
  })

  it('a plan that ran out long ago blocks new students, but a recent lapse does not', async () => {
    const small = (await sup.get('/platform/plans')).body.find((p: any) => p.name === 'Small')
    const big = (await sup.post('/platform/plans', { name: 'Big', maxStudents: 1000, priceMonthly: 900000 })).body
    expect((await patch(`/platform/schools/${w.schoolId}`, { planId: big.id, planEndsOn: daysFromNow(-5) })).status).toBe(200) // in the grace period
    expect((await newStudent(a.admin)).status).toBe(201)
    expect((await patch(`/platform/schools/${w.schoolId}`, { planEndsOn: daysFromNow(-30) })).status).toBe(200)
    const blocked = await newStudent(a.admin)
    expect(blocked.status).toBe(403)
    expect(blocked.body.message).toMatch(/ran out/)
    // Everything else keeps working: only adding students is held back.
    expect((await a.admin.post('/users', { name: 'Late Teacher', email: 'late@a.test', role: 'teacher' })).status).toBe(201)
    expect((await a.principal.post('/announcements', { title: 'Still here', body: 'ok' })).status).toBe(201)
    expect((await patch(`/platform/schools/${w.schoolId}`, { planId: small.id, planEndsOn: null })).status).toBe(200)
  })
})

describe('recording payments', () => {
  it('needs a plan, and only the super admin can do it', async () => {
    const body = { amount: 300000, method: 'bank', months: 3, reference: 'UTR123' }
    expect((await sup.post(`/platform/schools/${wb.schoolId}/payments`, body)).status).toBe(400) // B has no plan
    for (const r of ['admin', 'principal'] as const) expect((await a[r].post(`/platform/schools/${w.schoolId}/payments`, body)).status, r).toBe(403)
    for (const bad of [{ ...body, months: 0 }, { ...body, months: 37 }, { ...body, method: 'barter' }, { ...body, amount: -1 }]) expect((await sup.post(`/platform/schools/${w.schoolId}/payments`, bad)).status).toBe(400)
  })

  it('pays for the months after the current period, or from today when it has run out', async () => {
    await patch(`/platform/schools/${w.schoolId}`, { planEndsOn: daysFromNow(-40) }) // lapsed
    const first = await sup.post(`/platform/schools/${w.schoolId}/payments`, { amount: 100000, method: 'upi', months: 1 })
    expect(first.status).toBe(201)
    expect(first.body.periodFrom).toBe(daysFromNow(0))
    expect(first.body.periodTo).toBe(new Date(addMonths(day(daysFromNow(0)), 1).getTime() - 86_400_000).toISOString().slice(0, 10))
    // Paying again before it ends adds on after the end.
    const second = await sup.post(`/platform/schools/${w.schoolId}/payments`, { amount: 300000, method: 'bank', months: 3, reference: 'UTR9', note: 'Term fee' })
    expect(second.body.periodFrom).toBe(new Date(day(first.body.periodTo).getTime() + 86_400_000).toISOString().slice(0, 10))
    const school = await prisma.school.findUniqueOrThrow({ where: { id: w.schoolId } })
    expect(school.planEndsOn!.toISOString().slice(0, 10)).toBe(second.body.periodTo)
    const ledger = (await sup.get(`/platform/schools/${w.schoolId}/payments`)).body
    expect(ledger.map((p: any) => [p.amount, p.months])).toEqual([[300000, 3], [100000, 1]])
    expect(ledger[0]).toMatchObject({ reference: 'UTR9', note: 'Term fee', method: 'bank' })
    expect(await prisma.auditLog.count({ where: { schoolId: w.schoolId, action: 'school.payment_recorded' } })).toBe(2)
    expect((await sup.get(`/platform/schools/${w.schoolId}`)).body.billing.status).toBe('active')
  })
})

describe('the school\'s own billing page', () => {
  it('admin and principal can see it; nobody else', async () => {
    for (const r of ['admin', 'principal'] as const) {
      const res = await a[r].get('/school/billing')
      expect(res.status, r).toBe(200)
      expect(res.body).toMatchObject({ plan: { name: 'Small', maxStudents: 3 }, status: 'active' })
      expect(typeof res.body.endsOn).toBe('string')
    }
    for (const r of ['teacher', 'clerk', 'student', 'parent'] as const) expect((await a[r].get('/school/billing')).status, r).toBe(403)
    expect((await b.admin.get('/school/billing')).body).toMatchObject({ plan: null, status: 'none' })
    expect((await sup.get('/school/billing')).status).toBe(403)
  })
})

describe('a school\'s own data export', () => {
  it('gives the school admin its records, without passwords, private messages or other schools', async () => {
    // A private conversation, which must not appear.
    const conv = await prisma.conversation.create({ data: { schoolId: w.schoolId, userAId: [w.u.teacher, w.u.parent].sort()[0], userBId: [w.u.teacher, w.u.parent].sort()[1] } })
    await prisma.directMessage.create({ data: { conversationId: conv.id, senderId: w.u.teacher, body: 'a very private note about a child' } })
    await a.principal.post('/announcements', { title: 'Exported announcement', body: 'hello' })

    const res = await a.admin.get('/school/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*-export-\d{4}-\d{2}-\d{2}\.json"/)
    const text = res.text ?? JSON.stringify(res.body)
    const data = res.body
    expect(data.school.name).toBe('School A')
    expect(data.tables.User.length).toBeGreaterThan(5)
    expect(text).not.toMatch(/passwordHash/)
    expect(text).not.toMatch(/a very private note/)
    expect(data.tables.DirectMessage).toBeUndefined()
    expect(data.tables.Conversation).toBeUndefined()
    expect(data.tables.Notification).toBeUndefined()
    expect(data.tables.Announcement.map((x: any) => x.title)).toContain('Exported announcement')
    // Only this school: every row that names a school names this one, and no B person is in it.
    for (const [name, rows] of Object.entries<any[]>(data.tables)) for (const r of rows) if ('schoolId' in r) expect(r.schoolId, name).toBe(w.schoolId)
    expect(data.tables.User.some((u: any) => u.email.endsWith('@b.test'))).toBe(false)
    // Children without a schoolId column are included through their parents.
    expect(data.tables.ClassMember.length).toBeGreaterThan(0)
    expect(data.counts.User).toBe(data.tables.User.length)
    expect(await prisma.auditLog.count({ where: { schoolId: w.schoolId, action: 'school.exported' } })).toBe(1)
  })

  it('is for the admin only, and is limited to one every few minutes', async () => {
    for (const r of ['principal', 'teacher', 'clerk', 'student', 'parent'] as const) expect((await a[r].get('/school/export')).status, r).toBe(403)
    expect((await sup.get('/school/export')).status).toBe(403)
    const again = await a.admin.get('/school/export')
    expect(again.status).toBe(429)
    expect(again.body.message).toMatch(/Try again in/)
    expect((await b.admin.get('/school/export')).status).toBe(200) // another school has its own allowance
  })
})

describe('what counts as a school\'s data', () => {
  it('every table is either owned by a school, reached through a parent, or belongs to the platform', () => {
    const { unknown } = classifyModels()
    expect(unknown, `add these tables to CHILD_TABLES (or give them a schoolId): ${unknown.join(', ')}`).toEqual([])
    const models = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name))
    for (const [child, { parent, fk }] of Object.entries(CHILD_TABLES)) {
      expect(models.has(child), child).toBe(true)
      expect(models.has(parent), parent).toBe(true)
      expect(Prisma.dmmf.datamodel.models.find((m) => m.name === child)!.fields.some((f) => f.name === fk), `${child}.${fk}`).toBe(true)
    }
  })
})

describe('deleting a school', () => {
  const ownedCounts = async (schoolId: string) => {
    const out: Record<string, number> = {}
    for (const m of classifyModels().owned) out[m] = await (prisma as any)[m.charAt(0).toLowerCase() + m.slice(1)].count({ where: { schoolId } })
    return out
  }
  let docKey: string
  let ids: { classes: string[]; users: string[]; exams: string[]; invoices: string[]; assignments: string[]; conversations: string[] }
  let beforeA: Record<string, number>

  beforeAll(async () => {
    // Give school B some of everything worth checking.
    await b.principal.post('/announcements', { title: 'B news', body: 'x' })
    await b.teacher.post('/homework', { classIds: [wb.classA], title: 'B homework', description: 'd', dueDate: daysFromNow(3) })
    await b.teacher.post('/exams', { classId: wb.classA, name: 'B exam', subject: 'Maths', maxMarks: 50, date: daysFromNow(0) })
    await b.clerk.post('/fees/invoices', { classId: wb.classA, title: 'B fee', amount: 100000, dueDate: daysFromNow(10) })
    const conv = await b.teacher.post('/messages/conversations', { userId: wb.u.parent })
    if (conv.status === 201 || conv.status === 200) await b.teacher.post(`/messages/conversations/${conv.body.id}`, { body: 'hello from B' })
    const doc = await request(app.getHttpServer()).post('/api/documents').set('authorization', `Bearer ${b.clerk.token}`).field('title', 'B form').attach('file', PDF, 'form.pdf')
    expect(doc.status).toBe(201)
    docKey = (await prisma.schoolDocument.findFirstOrThrow({ where: { schoolId: wb.schoolId } })).storageKey
    expect(existsSync(join(resolve(process.env.UPLOAD_DIR ?? '.test-uploads'), docKey))).toBe(true)
    await prisma.mark.create({ data: { examId: (await prisma.exam.findFirstOrThrow({ where: { schoolId: wb.schoolId } })).id, studentId: wb.u.student, score: 40 } })
    ids = {
      classes: (await prisma.class.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
      users: (await prisma.user.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
      exams: (await prisma.exam.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
      invoices: (await prisma.invoice.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
      assignments: (await prisma.assignment.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
      conversations: (await prisma.conversation.findMany({ where: { schoolId: wb.schoolId }, select: { id: true } })).map((x) => x.id),
    }
    expect(ids.exams.length + ids.invoices.length + ids.assignments.length).toBeGreaterThan(2)
    expect(ids.conversations.length, 'school B needs a conversation for the delete check to mean something').toBeGreaterThan(0)
    expect(await prisma.directMessage.count({ where: { conversationId: { in: ids.conversations } } })).toBeGreaterThan(0)
    beforeA = await ownedCounts(w.schoolId)
  })

  it('needs the super admin, a suspended school, and the address typed out', async () => {
    for (const r of ['admin', 'principal'] as const) expect((await raw('delete', b[r], `/platform/schools/${wb.schoolId}`, { confirm: 'School B' })).status, r).toBe(403)
    expect((await raw('delete', sup, `/platform/schools/${wb.schoolId}`, { confirm: 'School B' })).status).toBe(409) // still active
    expect((await patch(`/platform/schools/${wb.schoolId}`, { active: false })).status).toBe(200)
    expect((await raw('delete', sup, `/platform/schools/${wb.schoolId}`, { confirm: 'wrong' })).status).toBe(400)
    expect((await raw('delete', sup, `/platform/schools/${wb.schoolId}`, {})).status).toBe(400)
    expect(await prisma.school.count({ where: { id: wb.schoolId } })).toBe(1)
    expect((await raw('delete', sup, `/platform/schools/${platformId}`, { confirm: 'Platform' })).status).toBe(404) // never the platform itself
    expect((await raw('delete', sup, '/platform/schools/nope', { confirm: 'x' })).status).toBe(404)
  })

  it('removes every record and stored file of the school, and touches nothing of another school', async () => {
    const res = await raw('delete', sup, `/platform/schools/${wb.schoolId}`, { confirm: 'school b' }) // case does not matter
    expect(res.status).toBe(200)
    expect(res.body.deleted).toMatchObject({ name: 'School B' })
    expect(res.body.deleted.files).toBeGreaterThanOrEqual(1)

    expect(await prisma.school.count({ where: { id: wb.schoolId } })).toBe(0)
    for (const [model, count] of Object.entries(await ownedCounts(wb.schoolId))) expect(count, model).toBe(0)
    // Tables reached through a parent are gone too.
    expect(await prisma.classMember.count({ where: { classId: { in: ids.classes } } })).toBe(0)
    expect(await prisma.channel.count({ where: { classId: { in: ids.classes } } })).toBe(0)
    expect(await prisma.mark.count({ where: { examId: { in: ids.exams } } })).toBe(0)
    expect(await prisma.payment.count({ where: { invoiceId: { in: ids.invoices } } })).toBe(0)
    expect(await prisma.submission.count({ where: { assignmentId: { in: ids.assignments } } })).toBe(0)
    expect(await prisma.directMessage.count({ where: { conversationId: { in: ids.conversations } } })).toBe(0)
    expect(await prisma.notificationPreference.count({ where: { userId: { in: ids.users } } })).toBe(0)
    expect(await prisma.user.count({ where: { id: { in: ids.users } } })).toBe(0)
    expect(existsSync(join(resolve(process.env.UPLOAD_DIR ?? '.test-uploads'), docKey))).toBe(false)

    // School A is exactly as it was.
    expect(await ownedCounts(w.schoolId)).toEqual(beforeA)
    expect((await a.admin.get('/users')).status).toBe(200)
  })

  it('locks the old people out, hides the address, and keeps a record in the platform\'s own log', async () => {
    expect((await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'admin@b.test', password: 'password123' })).status).toBe(401)
    expect((await request(app.getHttpServer()).get('/api/users').set('authorization', `Bearer ${b.admin.token}`)).status).toBe(401)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'school.deleted' } })
    expect(log.schoolId).toBe(platformId)
    expect(log.meta).toMatchObject({ name: 'School B', people: expect.any(Number), files: expect.any(Number) })
    expect((await sup.get('/platform/schools')).body.map((s: any) => s.name)).toEqual(['School A'])
  })
})
