import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, type World } from './helpers'

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

const body = (extra: object = {}) => ({ fromDate: daysFromNow(1), toDate: daysFromNow(2), reason: 'Fever', ...extra })

describe('leave: requesting', () => {
  it('students, teachers and clerks request their own leave', async () => {
    for (const r of ['student', 'teacher', 'clerk'] as const) {
      const res = await c[r].post('/leave', body())
      expect(res.status, r).toBe(201)
      expect(res.body.subjectName).toBeTruthy()
    }
  })

  it('a parent must choose a linked child, and cannot request for anyone else', async () => {
    expect((await c.parent.post('/leave', body())).status).toBe(400)
    expect((await c.parent.post('/leave', body({ studentId: w.u.student2 }))).status).toBe(403)
    const ok = await c.parent.post('/leave', body({ studentId: w.u.student }))
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ subjectUserId: w.u.student, requesterId: w.u.parent })
  })

  it("a student cannot request leave on another student's behalf", async () => {
    expect((await c.student.post('/leave', body({ studentId: w.u.student2 }))).status).toBe(403)
  })

  it('principal and admin do not request leave', async () => {
    expect((await c.principal.post('/leave', body())).status).toBe(403)
    expect((await c.admin.post('/leave', body())).status).toBe(403)
  })

  it('validates dates and reason', async () => {
    expect((await c.student.post('/leave', body({ fromDate: daysFromNow(5), toDate: daysFromNow(2) }))).status).toBe(400)
    expect((await c.student.post('/leave', body({ reason: 'x' }))).status).toBe(400)
    expect((await c.student.post('/leave', body({ fromDate: 'tomorrow' }))).status).toBe(400)
  })
})

describe('leave: who sees what', () => {
  it('requesters see their own; parents see their child; principal and admin see everything', async () => {
    expect((await c.student.get('/leave')).body.every((r: any) => r.requesterId === w.u.student || r.subjectUserId === w.u.student)).toBe(true)
    const parent = await c.parent.get('/leave')
    expect(parent.body.length).toBeGreaterThanOrEqual(2) // the child's own request and the parent's
    expect(parent.body.every((r: any) => [w.u.student, w.u.parent].includes(r.subjectUserId) || r.requesterId === w.u.parent)).toBe(true)
    expect((await c.student2.get('/leave')).body).toEqual([])
    const all = await c.principal.get('/leave')
    expect(all.body.length).toBe(await prisma.leaveRequest.count())
    expect((await c.admin.get('/leave')).body.length).toBe(all.body.length)
  })
})

describe('leave: deciding', () => {
  it('only the principal can approve; admin is read-only', async () => {
    const ids = (await prisma.leaveRequest.findMany({ where: { status: 'pending' } })).map((l) => l.id)
    for (const r of ['admin', 'student', 'parent', 'teacher', 'clerk'] as const) {
      expect((await c[r].post('/leave/bulk-approve', { ids, decision: 'approve' })).status, r).toBe(403)
    }
  })

  it('bulk reject needs a reason; bulk approve reports partial failure and notifies each requester', async () => {
    const pending = await prisma.leaveRequest.findMany({ where: { status: 'pending' } })
    const ids = pending.map((l) => l.id)
    expect((await c.principal.post('/leave/bulk-approve', { ids, decision: 'reject' })).status).toBe(400)

    const [first, ...rest] = ids
    await c.principal.post('/leave/bulk-approve', { ids: [first], decision: 'reject', reason: 'Exam week' })
    await prisma.notification.deleteMany({})
    const res = await c.principal.post('/leave/bulk-approve', { ids: [first, ...rest, 'bogus'], decision: 'approve', reason: 'Get well soon' })
    expect(res.body).toMatchObject({ total: ids.length + 1, succeeded: rest.length })
    expect(res.body.failed.map((f: any) => f.error).sort()).toEqual(['Already rejected', 'Not found'])

    const rows = await prisma.leaveRequest.findMany({ where: { id: { in: rest } } })
    expect(rows.every((r) => r.status === 'approved' && r.decisionNote === 'Get well soon' && r.decidedById === w.u.principal)).toBe(true)
    // One notification per approved request, to whoever asked (the parent's request goes to the parent).
    const notes = await prisma.notification.findMany({ where: { event: 'leave.approved', channel: 'in_app' } })
    expect(notes).toHaveLength(rest.length)
    expect(notes.some((n) => n.userId === w.u.parent)).toBe(true)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'leave.approved' } })).toBe(rest.length)
    // The parent can read it.
    const inbox = await c.parent.get('/notifications')
    expect(inbox.body.some((n: any) => n.subject === 'Leave approved')).toBe(true)
  })

  it('the rejected request shows the reason to the person who asked', async () => {
    const rejected = await c.student.get('/leave')
    const mine = rejected.body.find((l: any) => l.status === 'rejected')
    if (mine) expect(mine.decisionNote).toBe('Exam week')
    expect(await prisma.leaveRequest.count({ where: { status: 'rejected', decisionNote: 'Exam week' } })).toBe(1)
  })
})
