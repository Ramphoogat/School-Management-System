import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, makeUser, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>

const mkReq = (target: string, role: any, by = w.u.clerk, schoolId = w.schoolId) =>
  prisma.roleRequest.create({ data: { schoolId, targetUserId: target, requestedRole: role, requestedById: by } }).then((r) => r.id)

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('role requests: who can do what', () => {
  it('lets clerk and teacher submit requests, and nobody else', async () => {
    const body = { targetUserId: w.u.student2, requestedRole: 'teacher', note: 'new hire' }
    expect((await c.clerk.post('/role-requests', body)).status).toBe(201)
    expect((await c.teacher.post('/role-requests', body)).status).toBe(201)
    for (const r of ['student', 'parent', 'principal', 'admin'] as const) {
      expect((await c[r].post('/role-requests', body)).status, r).toBe(403)
    }
  })

  it('only principal and admin can view the approval queue', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) expect((await c[r].get('/role-requests')).status, r).toBe(403)
    for (const r of ['principal', 'admin'] as const) expect((await c[r].get('/role-requests')).status, r).toBe(200)
  })

  it('shows requesters their own requests only', async () => {
    const mine = await c.clerk.get('/role-requests/mine')
    expect(mine.status).toBe(200)
    expect(mine.body.every((r: any) => r.requestedById === w.u.clerk)).toBe(true)
    expect(mine.body[0].targetName).toBeTruthy()
    expect((await c.student.get('/role-requests/mine')).status).toBe(403)
  })

  it('rejects malformed requests and targets in another school', async () => {
    expect((await c.clerk.post('/role-requests', { targetUserId: w.u.student, requestedRole: 'emperor' })).status).toBe(400)
    const other = await seedWorldOther()
    expect((await c.clerk.post('/role-requests', { targetUserId: other.u.student, requestedRole: 'teacher' })).status).toBe(404)
  })
})

async function seedWorldOther() {
  const existing = await prisma.school.findFirst({ where: { name: 'School B' } })
  if (existing) return { u: { student: (await prisma.user.findFirst({ where: { schoolId: existing.id, role: 'student' } }))!.id }, schoolId: existing.id }
  const wb = await seedWorld('B')
  return wb
}

describe('role requests: deciding', () => {
  it('approving applies the role immediately and writes an audit entry', async () => {
    const id = await mkReq(w.u.student2, 'teacher')
    const res = await c.principal.post(`/role-requests/${id}/decide`, { decision: 'approve' })
    expect(res.status).toBe(201)
    expect((await prisma.user.findUnique({ where: { id: w.u.student2 } }))!.role).toBe('teacher')
    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.role_approved', resourceId: id } })
    expect(audit?.actorId).toBe(w.u.principal)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'student' } })
  })

  it('rejecting needs a reason, stores it, and leaves the role unchanged', async () => {
    const id = await mkReq(w.u.student2, 'clerk')
    expect((await c.principal.post(`/role-requests/${id}/decide`, { decision: 'reject' })).status).toBe(400)
    expect((await c.principal.post(`/role-requests/${id}/decide`, { decision: 'reject', reason: '  ' })).status).toBe(400)
    expect((await c.principal.post(`/role-requests/${id}/decide`, { decision: 'reject', reason: 'Not needed' })).status).toBe(201)
    const r = await prisma.roleRequest.findUnique({ where: { id } })
    expect(r).toMatchObject({ status: 'rejected', reason: 'Not needed' })
    expect((await prisma.user.findUnique({ where: { id: w.u.student2 } }))!.role).toBe('student')
  })

  it('cannot decide the same request twice', async () => {
    const id = await mkReq(w.u.student2, 'teacher')
    await c.admin.post(`/role-requests/${id}/decide`, { decision: 'approve' })
    const again = await c.principal.post(`/role-requests/${id}/decide`, { decision: 'approve' })
    expect(again.status).toBe(400)
    expect(again.body.message).toMatch(/already approved/i)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'student' } })
  })

  it('principal cannot grant admin or principal, admin can', async () => {
    const id = await mkReq(w.u.student2, 'admin')
    const denied = await c.principal.post(`/role-requests/${id}/decide`, { decision: 'approve' })
    expect(denied.status).toBe(400)
    expect(denied.body.message).toMatch(/cannot grant/i)
    expect((await prisma.user.findUnique({ where: { id: w.u.student2 } }))!.role).toBe('student')
    const id2 = await mkReq(w.u.student2, 'principal')
    expect((await c.principal.post(`/role-requests/${id2}/decide`, { decision: 'approve' })).status).toBe(400)
    expect((await c.admin.post(`/role-requests/${id}/decide`, { decision: 'approve' })).status).toBe(201)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'student' } })
  })

  it('nobody can change their own role', async () => {
    const id = await mkReq(w.u.principal, 'teacher')
    const res = await c.principal.post(`/role-requests/${id}/decide`, { decision: 'approve' })
    expect(res.status).toBe(400)
    expect((await prisma.user.findUnique({ where: { id: w.u.principal } }))!.role).toBe('principal')
    const id2 = await mkReq(w.u.admin, 'teacher')
    expect((await c.admin.post(`/role-requests/${id2}/decide`, { decision: 'approve' })).status).toBe(400)
  })

  it('forbids roles without approval rights', async () => {
    const id = await mkReq(w.u.student2, 'teacher')
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) {
      expect((await c[r].post(`/role-requests/${id}/decide`, { decision: 'approve' })).status, r).toBe(403)
    }
  })
})

describe('role requests: bulk decisions', () => {
  it('approves many in one action and reports each item, including failures', async () => {
    const users = await Promise.all([1, 2, 3].map((i) => makeUser(w.schoolId, `bulk${i}@a.test`, 'student')))
    const ids = await Promise.all(users.map((u) => mkReq(u.id, 'teacher')))
    const decided = await mkReq(w.u.student2, 'clerk')
    await c.principal.post(`/role-requests/${decided}/decide`, { decision: 'reject', reason: 'no' })
    await prisma.user.update({ where: { id: w.u.student2 }, data: { role: 'student' } })

    const res = await c.principal.post('/role-requests/bulk-approve', { ids: [...ids, decided, 'bogus-id'], decision: 'approve' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ total: 5, succeeded: 3 })
    expect(res.body.failed.map((f: any) => f.id).sort()).toEqual([decided, 'bogus-id'].sort())
    expect(res.body.failed.find((f: any) => f.id === decided).error).toMatch(/already rejected/i)

    for (const u of users) expect((await prisma.user.findUnique({ where: { id: u.id } }))!.role).toBe('teacher')

    // One bulk entry plus one audit entry per approved record, tied together by bulkId.
    const bulk = await prisma.bulkActionLog.findUnique({ where: { id: res.body.bulkId } })
    expect(bulk).toMatchObject({ resource: 'role_request', action: 'approve', actorId: w.u.principal })
    expect(bulk!.recordIds).toHaveLength(5)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'user.role_approved' } })).toBe(3)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'role_request.bulk_approve' } })).toBe(1)
  })

  it('bulk reject requires one shared reason and stores it on every record', async () => {
    const users = await Promise.all([1, 2].map((i) => makeUser(w.schoolId, `rej${i}@a.test`, 'student')))
    const ids = await Promise.all(users.map((u) => mkReq(u.id, 'clerk')))
    expect((await c.admin.post('/role-requests/bulk-approve', { ids, decision: 'reject' })).status).toBe(400)
    const res = await c.admin.post('/role-requests/bulk-approve', { ids, decision: 'reject', reason: 'Hiring freeze' })
    expect(res.body.succeeded).toBe(2)
    const rows = await prisma.roleRequest.findMany({ where: { id: { in: ids } } })
    expect(rows.every((r) => r.status === 'rejected' && r.reason === 'Hiring freeze')).toBe(true)
  })

  it('applies the same guardrails per item as a single decision', async () => {
    const u = await makeUser(w.schoolId, 'sneaky@a.test', 'student')
    const adminReq = await mkReq(u.id, 'admin')
    const okReq = await mkReq((await makeUser(w.schoolId, 'fine@a.test', 'student')).id, 'teacher')
    const res = await c.principal.post('/role-requests/bulk-approve', { ids: [adminReq, okReq], decision: 'approve' })
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed[0]).toMatchObject({ id: adminReq })
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.role).toBe('student')
  })

  it('is forbidden for roles without bulk approval, and validates input', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) {
      expect((await c[r].post('/role-requests/bulk-approve', { ids: ['x'], decision: 'approve' })).status, r).toBe(403)
    }
    expect((await c.principal.post('/role-requests/bulk-approve', { ids: [], decision: 'approve' })).status).toBe(400)
    expect((await c.principal.post('/role-requests/bulk-approve', { ids: ['x'], decision: 'maybe' })).status).toBe(400)
  })

  it('never touches another school even when given its ids', async () => {
    const wb = await prisma.school.findFirst({ where: { name: 'School B' } })
    const other = await makeUser(wb!.id, 'victim@b.test', 'student')
    const id = await mkReq(other.id, 'teacher', w.u.clerk, wb!.id)
    const res = await c.principal.post('/role-requests/bulk-approve', { ids: [id], decision: 'approve' })
    expect(res.body.succeeded).toBe(0)
    expect(res.body.failed[0].error).toMatch(/not permitted/i)
    expect((await prisma.user.findUnique({ where: { id: other.id } }))!.role).toBe('student')
    const list = await c.principal.get('/role-requests')
    expect(list.body.some((r: any) => r.id === id)).toBe(false)
  })
})
