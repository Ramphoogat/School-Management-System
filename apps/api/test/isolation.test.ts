import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, today, type World } from './helpers'

/**
 * Two schools share one database. Nothing a user in school B does, even with school A's ids,
 * may read or change school A's data. (README section 13: school_id on every query.)
 */
let app: INestApplication
let a: World, b: World
let A: Awaited<ReturnType<typeof clients>>, B: Awaited<ReturnType<typeof clients>>
let examA: string, invoiceA: string, leaveA: string, admissionA: string

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  a = await seedWorld('A'); b = await seedWorld('B')
  A = await clients(app, 'a'); B = await clients(app, 'b')

  // School A data for B to try to reach.
  const ex = await A.teacher.post('/exams', { classId: a.classA, name: 'Secret', subject: 'Maths', maxMarks: 10, date: '2026-09-01' })
  examA = ex.body.id
  await A.teacher.put(`/exams/${examA}/marks`, { marks: [{ studentId: a.u.student, score: 9 }, { studentId: a.u.student2, score: 8 }] })
  await A.teacher.post(`/exams/${examA}/submit`)
  await A.clerk.post('/fees/invoices', { classId: a.classA, title: 'A Fee', amount: 100000, dueDate: daysFromNow(-1) })
  invoiceA = (await prisma.invoice.findFirst({ where: { schoolId: a.schoolId } }))!.id
  leaveA = (await A.student.post('/leave', { fromDate: daysFromNow(1), toDate: daysFromNow(1), reason: 'Private reason' })).body.id
  await A.clerk.post('/admissions', { classId: a.classA, studentName: 'New A', studentEmail: 'new@a.test', parentName: 'PA', parentEmail: 'pa@a.test' })
  admissionA = (await prisma.admission.findFirst({ where: { schoolId: a.schoolId } }))!.id
  await A.teacher.post(`/attendance/class/${a.classA}/bulk`, { date: today(), records: [{ studentId: a.u.student, status: 'absent' }] })
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('cross-school isolation', () => {
  it("B's principal cannot see or decide A's exam results", async () => {
    expect((await B.principal.get('/exams/queue')).body).toEqual([])
    const res = await B.principal.post('/exams/bulk-approve', { ids: [examA], decision: 'approve' })
    expect(res.body.succeeded).toBe(0)
    expect(res.body.failed[0].error).toMatch(/not permitted/i)
    expect((await prisma.exam.findUnique({ where: { id: examA } }))!.status).toBe('submitted')
  })

  it("B's staff cannot open A's marks, exams list, roster or report cards", async () => {
    expect((await B.principal.get(`/exams/${examA}/marks`)).status).toBe(404)
    expect((await B.teacher.get(`/exams?classId=${a.classA}`)).status).toBe(403)
    expect((await B.teacher.get(`/attendance/class/${a.classA}`)).status).toBe(403)
    expect((await B.principal.get(`/attendance/student/${a.u.student}`)).status).toBe(403)
    expect((await B.principal.get(`/results/student/${a.u.student}`)).status).toBe(403)
  })

  it("B's clerk cannot see, bill, or mark paid A's fees", async () => {
    expect((await B.clerk.get('/fees/invoices')).body).toEqual([])
    expect((await B.clerk.get(`/fees/invoices?classId=${a.classA}`)).body).toEqual([])
    const pay = await B.clerk.post('/fees/bulk-pay', { ids: [invoiceA], method: 'cash' })
    expect(pay.body.succeeded).toBe(0)
    expect(pay.body.failed[0].error).toMatch(/not permitted/i)
    expect((await B.clerk.post('/fees/invoices', { classId: a.classA, title: 'Hijack', amount: 5000, dueDate: daysFromNow(3) })).status).toBe(403)
    expect((await prisma.invoice.findUnique({ where: { id: invoiceA } }))!.status).toBe('unpaid')
    expect((await B.principal.get('/fees/waivers')).body).toEqual([])
  })

  it("B's principal cannot see or decide A's leave", async () => {
    expect((await B.principal.get('/leave')).body.some((l: any) => l.id === leaveA)).toBe(false)
    const res = await B.principal.post('/leave/bulk-approve', { ids: [leaveA], decision: 'approve' })
    expect(res.body.succeeded).toBe(0)
    expect((await prisma.leaveRequest.findUnique({ where: { id: leaveA } }))!.status).toBe('pending')
  })

  it("B cannot see or decide A's admissions, students, or parent links", async () => {
    expect((await B.clerk.get('/admissions')).body).toEqual([])
    const res = await B.principal.post('/admissions/bulk-approve', { ids: [admissionA], decision: 'approve' })
    expect(res.body.succeeded).toBe(0)
    expect((await B.clerk.get('/students')).body.every((s: any) => s.email.endsWith('@b.test'))).toBe(true)
    expect((await B.principal.get('/links')).body.every((l: any) => l.schoolId === b.schoolId)).toBe(true)
    const link = await prisma.parentStudentLink.findFirst({ where: { schoolId: a.schoolId } })
    expect((await B.principal.post(`/links/${link!.id}/revoke`)).status).toBe(404)
    expect((await prisma.parentStudentLink.findUnique({ where: { id: link!.id } }))!.status).toBe('approved')
  })

  it("B's admin lists only B's users, classes, audit log and analytics", async () => {
    expect((await B.admin.get('/users')).body.every((u: any) => u.email.endsWith('@b.test'))).toBe(true)
    expect((await B.admin.get('/classes')).body.every((c: any) => c.schoolId === b.schoolId)).toBe(true)
    const audit = await B.admin.get('/audit')
    expect(audit.body.rows.length).toBeGreaterThan(0)
    expect(audit.body.rows.every((r: any) => r.schoolId === b.schoolId)).toBe(true)
    const an = await B.principal.get('/analytics/overview')
    expect(an.body.people.student).toBe(2)
    expect(an.body.attendance.today.marked).toBe(0) // A's attendance today is not counted
    expect(an.body.fees.billed).toBe(0)
  })

  it("B cannot post announcements or homework into A's class, or grant roles on A's users", async () => {
    expect((await B.principal.post('/announcements', { classId: a.classA, title: 'x', body: 'y' })).status).toBe(403)
    expect((await B.teacher.post('/homework', { classIds: [a.classA], title: 'x', description: '', dueDate: daysFromNow(2) })).status).toBe(403)
    expect((await B.clerk.post('/role-requests', { targetUserId: a.u.student, requestedRole: 'teacher' })).status).toBe(404)
    expect((await B.principal.put(`/timetable/class/${a.classA}`, { slots: [] })).status).toBe(403)
    expect((await B.principal.get(`/chat/${a.classA}`)).status).toBe(403)
  })

  it("B's clerk cannot issue certificates for A's students", async () => {
    const res = await B.clerk.post('/certificates/bulk-issue', { studentIds: [a.u.student], type: 'bonafide' })
    expect(res.body.succeeded).toBe(0)
    expect(await prisma.certificate.count({ where: { schoolId: a.schoolId } })).toBe(0)
  })

  it('the same email may exist in both schools without mixing accounts (unique per school)', async () => {
    const dup = await prisma.user.create({ data: { schoolId: b.schoolId, email: 'student@a.test', name: 'Twin', role: 'student', passwordHash: 'x' } })
    expect(dup.schoolId).toBe(b.schoolId)
    await prisma.user.delete({ where: { id: dup.id } })
  })
})
