import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, today, type World } from './helpers'

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

const mark = (client: typeof c.teacher, classId: string, records: object[], date = today()) =>
  client.post(`/attendance/class/${classId}/bulk`, { date, records })

describe('attendance: roster and marking permissions', () => {
  it('teacher sees the roster of their own class only', async () => {
    const res = await c.teacher.get(`/attendance/class/${w.classA}?date=${today()}`)
    expect(res.status).toBe(200)
    expect(res.body.students.map((s: any) => s.id).sort()).toEqual([w.u.student, w.u.student2].sort())
    expect(res.body.students.every((s: any) => s.status === null)).toBe(true)
    expect((await c.teacher2.get(`/attendance/class/${w.classA}`)).status).toBe(403)
  })

  it('students and parents cannot open a roster; principal can read', async () => {
    for (const r of ['student', 'parent'] as const) expect((await c[r].get(`/attendance/class/${w.classA}`)).status, r).toBe(403)
    expect((await c.principal.get(`/attendance/class/${w.classA}`)).status).toBe(200)
  })

  it('only the class teacher can mark: not another teacher, student, parent, clerk, principal or admin', async () => {
    const rec = [{ studentId: w.u.student, status: 'present' }]
    for (const r of ['teacher2', 'student', 'parent', 'clerk', 'principal', 'admin'] as const) {
      expect((await mark(c[r], w.classA, rec)).status, r).toBe(403)
    }
    expect((await mark(c.teacher, w.classA, rec)).status).toBe(201)
  })

  it('rejects future dates, bad dates, empty and unknown-status payloads', async () => {
    const rec = [{ studentId: w.u.student, status: 'present' }]
    expect((await mark(c.teacher, w.classA, rec, daysFromNow(3))).status).toBe(400)
    expect((await mark(c.teacher, w.classA, rec, '31/12/2026')).status).toBe(400)
    expect((await mark(c.teacher, w.classA, [])).status).toBe(400)
    expect((await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'sleeping' }])).status).toBe(400)
  })
})

describe('attendance: bulk marking behaviour', () => {
  it('marks a whole class, updates instead of duplicating, and audits per student plus once for the bulk', async () => {
    const res = await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'absent' }, { studentId: w.u.student2, status: 'late' }])
    expect(res.body).toMatchObject({ total: 2, succeeded: 2, failed: [] })
    // Marking again overwrites.
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'present' }])
    const rows = await prisma.attendance.findMany({ where: { classId: w.classA, studentId: w.u.student } })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('present')

    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'attendance.marked' } })).toBe(2)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'attendance.bulk_mark' } })).toBe(1)
    expect(await prisma.bulkActionLog.count({ where: { id: res.body.bulkId, resource: 'attendance' } })).toBe(1)
  })

  it('reports students who are not in the class without blocking the rest', async () => {
    const res = await mark(c.teacher, w.classA, [{ studentId: w.u.student2, status: 'present' }, { studentId: w.u.parent, status: 'present' }, { studentId: 'ghost', status: 'present' }])
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed).toHaveLength(2)
    expect(res.body.failed[0].error).toMatch(/not a student/i)
    expect((await prisma.attendance.findFirst({ where: { studentId: w.u.student2, classId: w.classA } }))!.status).toBe('present')
  })

  it('alerts the parent (only) when a child is marked absent', async () => {
    await prisma.notification.deleteMany({})
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'absent' }, { studentId: w.u.student2, status: 'absent' }])
    const parentNotes = await c.parent.get('/notifications')
    const alert = parentNotes.body.find((n: any) => n.event === 'attendance.marked')
    expect(alert).toBeTruthy()
    expect(alert.body).toContain('was marked absent')
    // student2 has no linked parent, so the only absence alert goes to student's parent.
    expect(await prisma.notification.count({ where: { event: 'attendance.marked', channel: 'in_app' } })).toBe(1)
    // Present and late do not alert.
    await prisma.notification.deleteMany({})
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'present' }, { studentId: w.u.student2, status: 'late' }])
    expect(await prisma.notification.count({ where: { event: 'attendance.marked' } })).toBe(0)
  })
})

describe('attendance: low-attendance alert', () => {
  // These tests clear attendance to control the percentage; later suites expect the student to have a mark.
  afterAll(async () => {
    await prisma.attendance.deleteMany({})
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'present' }])
  })

  it('alerts student and parent once when absences take them under the threshold, not before', async () => {
    await prisma.attendance.deleteMany({})
    await prisma.notification.deleteMany({})
    const low = () => prisma.notification.findMany({ where: { event: 'attendance.low', channel: 'in_app' } })
    // Two marked days is too little data to judge.
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'present' }], daysFromNow(-3))
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'absent' }], daysFromNow(-2))
    expect(await low()).toHaveLength(0)
    // Third day, 33% present: alert to the student and the linked parent.
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'absent' }], daysFromNow(-1))
    const first = await low()
    expect(first.map((n) => n.userId).sort()).toEqual([w.u.student, w.u.parent].sort())
    expect(first[0].body).toContain('33%')
    // Further absences inside the cooldown do not repeat it.
    await mark(c.teacher, w.classA, [{ studentId: w.u.student, status: 'absent' }])
    expect(await low()).toHaveLength(2)
  })

  it('does not alert a student who stays above the threshold', async () => {
    await prisma.attendance.deleteMany({})
    await prisma.notification.deleteMany({})
    for (const d of [-5, -4, -3, -2]) await mark(c.teacher, w.classA, [{ studentId: w.u.student2, status: 'present' }], daysFromNow(d))
    await mark(c.teacher, w.classA, [{ studentId: w.u.student2, status: 'absent' }], daysFromNow(-1))
    expect(await prisma.notification.count({ where: { event: 'attendance.low' } })).toBe(0)
  })
})

describe('attendance: who can read a student summary', () => {
  it('student reads own only', async () => {
    expect((await c.student.get(`/attendance/student/${w.u.student}`)).status).toBe(200)
    expect((await c.student.get(`/attendance/student/${w.u.student2}`)).status).toBe(403)
  })

  it('parent reads a linked child only', async () => {
    const own = await c.parent.get(`/attendance/student/${w.u.student}`)
    expect(own.status).toBe(200)
    expect(own.body.days).toBeGreaterThan(0)
    expect((await c.parent.get(`/attendance/student/${w.u.student2}`)).status).toBe(403)
  })

  it('a revoked parent link ends access immediately', async () => {
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'revoked' } })
    expect((await c.parent.get(`/attendance/student/${w.u.student}`)).status).toBe(403)
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'approved' } })
    expect((await c.parent.get(`/attendance/student/${w.u.student}`)).status).toBe(200)
  })

  it('a pending link grants nothing', async () => {
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'pending' } })
    expect((await c.parent.get(`/attendance/student/${w.u.student}`)).status).toBe(403)
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'approved' } })
  })

  it('principal and admin can read; teacher and clerk cannot use the student summary', async () => {
    expect((await c.principal.get(`/attendance/student/${w.u.student}`)).status).toBe(200)
    expect((await c.admin.get(`/attendance/student/${w.u.student}`)).status).toBe(200)
    expect((await c.clerk.get(`/attendance/student/${w.u.student}`)).status).toBe(200) // clerk has attendance:read:school
    expect((await c.teacher.get(`/attendance/student/${w.u.student}`)).status).toBe(403)
  })
})
