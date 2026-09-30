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

const mark = (date: string, records: { studentId: string; status: string }[]) => c.teacher.post(`/attendance/class/${w.classA}/bulk`, { date, records })
const roster = async (date: string) => (await c.teacher.get(`/attendance/class/${w.classA}?date=${date}`)).body.students as { id: string; status: string | null; onLeave: boolean; leaveReason: string | null }[]
const rosterOf = async (date: string, id: string) => (await roster(date)).find((s) => s.id === id)!
const dateRow = (studentId: string, date: string) => prisma.attendance.findFirst({ where: { studentId, date: new Date(`${date}T00:00:00.000Z`) } })
const requestLeave = (who: 'student' | 'student2' | 'teacher', from: string, to: string, reason = 'Fever') => c[who].post('/leave', { fromDate: from, toDate: to, reason })
const decide = (ids: string[], decision: 'approve' | 'reject') => c.principal.post('/leave/bulk-approve', { ids, decision, reason: decision === 'reject' ? 'Not convincing' : undefined })

const D2 = daysFromNow(-2), D1 = daysFromNow(-1), D0 = today(), D5 = daysFromNow(-5)

describe('approved leave and attendance', () => {
  it('flags a student as on leave only once the leave is approved, and only for the days it covers', async () => {
    const l = await requestLeave('student', D2, D0, 'Fever')
    expect(l.status).toBe(201)
    expect((await rosterOf(D1, w.u.student)).onLeave).toBe(false) // still pending
    expect((await decide([l.body.id], 'approve')).body.succeeded).toBe(1)
    expect(await rosterOf(D1, w.u.student)).toMatchObject({ onLeave: true, leaveReason: 'Fever', status: null })
    expect((await rosterOf(D5, w.u.student)).onLeave).toBe(false) // outside the dates
    expect((await rosterOf(D1, w.u.student2)).onLeave).toBe(false) // someone else
  })

  it('a rejected or pending leave never counts', async () => {
    const rejected = await requestLeave('student2', D1, D0, 'Trip')
    await decide([rejected.body.id], 'reject')
    await requestLeave('student2', D1, D0, 'Another trip') // left pending
    expect((await rosterOf(D0, w.u.student2)).onLeave).toBe(false)
    const r = await mark(D0, [{ studentId: w.u.student2, status: 'leave' }])
    expect(r.body.failed[0].error).toMatch(/No approved leave/)
    expect(await dateRow(w.u.student2, D0)).toBeNull()
  })

  it('"on leave" can be recorded for a student with approved leave, and no absence alert is sent for it', async () => {
    const r = await mark(D0, [{ studentId: w.u.student, status: 'leave' }])
    expect(r.body).toMatchObject({ succeeded: 1 })
    expect((await dateRow(w.u.student, D0))?.status).toBe('leave')
    expect(await rosterOf(D0, w.u.student)).toMatchObject({ status: 'leave', onLeave: true })
    // The student's calendar shows the recorded leave day.
    const cal = (await c.student.get(`/attendance/student/${w.u.student}/calendar?month=${D0.slice(0, 7)}`)).body
    expect(cal.days).toContainEqual({ date: D0, status: 'leave' })
    // The parent is told about absences, not about approved leave.
    expect(await prisma.notification.count({ where: { userId: w.u.parent, event: 'attendance.marked' } })).toBe(0)
  })

  it('the teacher can still override it: marking absent is stored and alerts the parent', async () => {
    const r = await mark(D0, [{ studentId: w.u.student, status: 'absent' }])
    expect(r.body.succeeded).toBe(1)
    expect(await rosterOf(D0, w.u.student)).toMatchObject({ status: 'absent', onLeave: true })
    expect(await prisma.notification.count({ where: { userId: w.u.parent, event: 'attendance.marked', channel: 'in_app' } })).toBe(1)
    await mark(D0, [{ studentId: w.u.student, status: 'leave' }]) // put it back
  })
})

describe('approving a leave after days were already marked absent', () => {
  it('turns those absent days into leave, and leaves other days and other dates alone', async () => {
    // Fresh student with marks before any leave exists.
    await mark(daysFromNow(-8), [{ studentId: w.u.student2, status: 'absent' }])
    await mark(daysFromNow(-7), [{ studentId: w.u.student2, status: 'absent' }])
    await mark(daysFromNow(-6), [{ studentId: w.u.student2, status: 'late' }])
    await mark(daysFromNow(-5), [{ studentId: w.u.student2, status: 'present' }])
    await mark(daysFromNow(-4), [{ studentId: w.u.student2, status: 'absent' }])

    const l = await requestLeave('student2', daysFromNow(-7), daysFromNow(-5), 'Chickenpox')
    expect((await decide([l.body.id], 'approve')).body.succeeded).toBe(1)

    expect((await dateRow(w.u.student2, daysFromNow(-8)))?.status).toBe('absent') // before the leave
    expect((await dateRow(w.u.student2, daysFromNow(-7)))?.status).toBe('leave') // absent inside it, now excused
    expect((await dateRow(w.u.student2, daysFromNow(-6)))?.status).toBe('late') // attended, untouched
    expect((await dateRow(w.u.student2, daysFromNow(-5)))?.status).toBe('present')
    expect((await dateRow(w.u.student2, daysFromNow(-4)))?.status).toBe('absent') // after the leave
    const audit = await prisma.auditLog.findMany({ where: { action: 'attendance.leave_applied', resourceId: w.u.student2 } })
    expect(audit).toHaveLength(1)
    expect(audit[0].meta).toMatchObject({ days: 1 })
  })

  it('does nothing for a teacher\'s own leave, and does not fail the approval', async () => {
    const l = await requestLeave('teacher', D2, D0, 'Conference')
    const r = await decide([l.body.id], 'approve')
    expect(r.body).toMatchObject({ succeeded: 1 })
    expect(await prisma.auditLog.count({ where: { action: 'attendance.leave_applied', resourceId: w.u.teacher } })).toBe(0)
  })
})

describe('leave days in the numbers', () => {
  it('are left out of the percentage and the day count, but still shown in the recent list', async () => {
    await prisma.attendance.deleteMany({ where: { studentId: w.u.student2 } })
    const at = (n: number) => new Date(`${daysFromNow(-n)}T00:00:00.000Z`)
    const rows = [['present', 1], ['present', 2], ['present', 3], ['absent', 4], ['leave', 5], ['leave', 6]] as const
    await prisma.attendance.createMany({ data: rows.map(([status, n]) => ({ schoolId: w.schoolId, classId: w.classA, studentId: w.u.student2, date: at(n), status, markedById: w.u.teacher })) })
    const s = (await c.student2.get(`/attendance/student/${w.u.student2}`)).body
    expect(s).toMatchObject({ percent: 75, days: 4 }) // 3 attended of 4 counted, not 3 of 6
    expect(s.recent.filter((r: any) => r.status === 'leave')).toHaveLength(2)
  })

  it('do not hide, or cause, a low-attendance alert', async () => {
    // Two present and six leave days: only 2 counted days, too few to judge, so nothing is sent.
    await prisma.attendance.deleteMany({ where: { studentId: w.u.student2 } })
    await prisma.notification.deleteMany({ where: { event: 'attendance.low' } })
    const at = (n: number) => new Date(`${daysFromNow(-n)}T00:00:00.000Z`)
    const rows = [['present', 10], ['present', 11], ['leave', 12], ['leave', 13], ['leave', 14], ['leave', 15], ['leave', 16], ['leave', 17]] as const
    await prisma.attendance.createMany({ data: rows.map(([status, n]) => ({ schoolId: w.schoolId, classId: w.classA, studentId: w.u.student2, date: at(n), status, markedById: w.u.teacher })) })
    // One absence: 3 counted days, 2 of 3 attended = 67%, under the 75% line. With the leave days counted it would be 80% and stay quiet.
    await mark(D1, [{ studentId: w.u.student2, status: 'absent' }])
    const low = await prisma.notification.findMany({ where: { userId: w.u.student2, event: 'attendance.low' } })
    expect(low.length).toBeGreaterThan(0)
    expect(low[0].body).toMatch(/67%/)
  })
})
