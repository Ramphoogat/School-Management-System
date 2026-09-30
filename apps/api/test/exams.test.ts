import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

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

const newExam = async (name = 'Unit Test', subject = 'Maths', maxMarks = 50) => {
  const r = await c.teacher.post('/exams', { classId: w.classA, name, subject, maxMarks, date: '2026-09-20' })
  expect(r.status).toBe(201)
  return r.body.id as string
}
const enterAll = (id: string, a = 40, b = 30) =>
  c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: a }, { studentId: w.u.student2, score: b }] })

describe('exams: creating and entering marks', () => {
  it('only the class teacher can create exams', async () => {
    const body = { classId: w.classA, name: 'X', subject: 'Y', maxMarks: 10, date: '2026-09-20' }
    for (const r of ['teacher2', 'student', 'parent', 'clerk', 'principal', 'admin'] as const) expect((await c[r].post('/exams', body)).status, r).toBe(403)
    expect((await c.teacher.post('/exams', body)).status).toBe(201)
  })

  it('validates exam input', async () => {
    expect((await c.teacher.post('/exams', { classId: w.classA, name: 'X', subject: 'Y', maxMarks: 0, date: '2026-09-20' })).status).toBe(400)
    expect((await c.teacher.post('/exams', { classId: w.classA, name: 'X', subject: 'Y', maxMarks: 10, date: 'yesterday' })).status).toBe(400)
  })

  it('only the class teacher can enter marks', async () => {
    const id = await newExam()
    for (const r of ['teacher2', 'student', 'parent', 'clerk', 'principal', 'admin'] as const) {
      expect((await c[r].put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 1 }] })).status, r).toBe(403)
    }
  })

  it('rejects scores above the maximum or below zero, per item, and accepts the rest', async () => {
    const id = await newExam()
    const res = await c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 99 }, { studentId: w.u.student2, score: -1 }, { email: 'student@a.test', score: 45 }] })
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed).toHaveLength(2)
    expect(res.body.failed[0].error).toMatch(/between 0 and 50/)
    expect((await prisma.mark.findUnique({ where: { examId_studentId: { examId: id, studentId: w.u.student } } }))!.score).toBe(45)
  })

  it('imports by email (CSV style) and rejects people outside the class', async () => {
    const id = await newExam()
    const res = await c.teacher.put(`/exams/${id}/marks`, { marks: [{ email: 'STUDENT@a.test', score: 20 }, { email: 'parent@a.test', score: 20 }, { email: 'nobody@a.test', score: 20 }] })
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed.map((f: any) => f.key).sort()).toEqual(['nobody@a.test', 'parent@a.test'])
  })

  it('records an absent student without a score', async () => {
    const id = await newExam()
    await c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, absent: true, score: 30 }] })
    const m = await prisma.mark.findUnique({ where: { examId_studentId: { examId: id, studentId: w.u.student } } })
    expect(m).toMatchObject({ absent: true, score: null })
  })
})

describe('exams: submit, approval and visibility', () => {
  it('cannot submit until every student has a mark, then locks marks', async () => {
    const id = await newExam()
    await c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 40 }] })
    const early = await c.teacher.post(`/exams/${id}/submit`)
    expect(early.status).toBe(400)
    expect(early.body.message).toMatch(/1 of 2/)
    await enterAll(id)
    expect((await c.teacher.post(`/exams/${id}/submit`)).status).toBe(201)
    const locked = await c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 1 }] })
    expect(locked.status).toBe(400)
    expect(locked.body.message).toMatch(/locked/i)
    expect((await c.teacher.post(`/exams/${id}/submit`)).status).toBe(400)
  })

  it('hides results from students and parents until approved, then shows only their own', async () => {
    const id = await newExam('Term 1', 'Science', 100)
    await enterAll(id, 88, 61)
    expect((await c.student.get(`/exams/${id}/marks`)).status).toBe(403)
    expect((await c.parent.get(`/exams/${id}/marks`)).status).toBe(403)
    await c.teacher.post(`/exams/${id}/submit`)
    expect((await c.student.get(`/exams/${id}/marks`)).status).toBe(403)
    expect((await c.student.get(`/exams?classId=${w.classA}`)).body.some((e: any) => e.id === id)).toBe(false)

    expect((await c.principal.post(`/exams/bulk-approve`, { ids: [id], decision: 'approve' })).body.succeeded).toBe(1)

    const s = await c.student.get(`/exams/${id}/marks`)
    expect(s.status).toBe(200)
    expect(s.body.marks).toHaveLength(1)
    expect(s.body.marks[0]).toMatchObject({ studentId: w.u.student, score: 88 })
    expect(s.body.canEdit).toBe(false)
    const p = await c.parent.get(`/exams/${id}/marks`)
    expect(p.body.marks.map((m: any) => m.studentId)).toEqual([w.u.student])
  })

  it('only the principal can approve; teacher, clerk and admin cannot', async () => {
    const id = await newExam()
    await enterAll(id)
    await c.teacher.post(`/exams/${id}/submit`)
    for (const r of ['teacher', 'student', 'parent', 'clerk', 'admin'] as const) {
      expect((await c[r].post('/exams/bulk-approve', { ids: [id], decision: 'approve' })).status, r).toBe(403)
      expect((await c[r].post(`/exams/${id}/decide`, { decision: 'approve' })).status, r).toBe(403)
    }
    expect((await prisma.exam.findUnique({ where: { id } }))!.status).toBe('submitted')
  })

  it('sending back needs a reason, unlocks editing, and allows resubmission', async () => {
    const id = await newExam()
    await enterAll(id)
    await c.teacher.post(`/exams/${id}/submit`)
    expect((await c.principal.post('/exams/bulk-approve', { ids: [id], decision: 'reject' })).status).toBe(400)
    const res = await c.principal.post('/exams/bulk-approve', { ids: [id], decision: 'reject', reason: 'Recheck Q3' })
    expect(res.body.succeeded).toBe(1)
    const seen = await c.teacher.get(`/exams/${id}/marks`)
    expect(seen.body.exam).toMatchObject({ status: 'rejected', reason: 'Recheck Q3' })
    expect(seen.body.canEdit).toBe(true)
    expect((await enterAll(id, 41, 31)).status).toBe(200)
    expect((await c.teacher.post(`/exams/${id}/submit`)).status).toBe(201)
    expect((await prisma.exam.findUnique({ where: { id } }))!.reason).toBeNull()
  })

  it('bulk approval handles partial failure and emits one notification per student', async () => {
    const a = await newExam('A', 'Maths', 100)
    const b = await newExam('B', 'English', 100)
    await enterAll(a, 80, 70); await enterAll(b, 60, 50)
    await c.teacher.post(`/exams/${a}/submit`); await c.teacher.post(`/exams/${b}/submit`)
    await c.principal.post('/exams/bulk-approve', { ids: [b], decision: 'approve' })
    await prisma.notification.deleteMany({})

    const res = await c.principal.post('/exams/bulk-approve', { ids: [a, b, 'bogus'], decision: 'approve' })
    expect(res.body).toMatchObject({ total: 3, succeeded: 1 })
    expect(res.body.failed.map((f: any) => f.error).sort()).toEqual(['Already approved', 'Not found'])
    // Approving exam A notifies student, student2 and the parent of student: 3 in-app messages.
    expect(await prisma.notification.count({ where: { event: 'results.approved', channel: 'in_app' } })).toBe(3)
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'results.approved' } })).toBe(1)
    expect(await prisma.bulkActionLog.count({ where: { id: res.body.bulkId, resource: 'exam' } })).toBe(1)
  })
})

describe('report cards', () => {
  it('include approved results only, with percent, grade and totals', async () => {
    await resetDb(); w = await seedWorld('A'); c = await clients(app)
    const approved = await newExam('Done', 'Maths', 50)
    await enterAll(approved, 45, 20); await c.teacher.post(`/exams/${approved}/submit`)
    await c.principal.post('/exams/bulk-approve', { ids: [approved], decision: 'approve' })
    const pending = await newExam('Pending', 'Art', 50)
    await enterAll(pending, 10, 10); await c.teacher.post(`/exams/${pending}/submit`)

    const card = await c.student.get(`/results/student/${w.u.student}`)
    expect(card.status).toBe(200)
    expect(card.body.results).toHaveLength(1)
    expect(card.body.results[0]).toMatchObject({ subject: 'Maths', score: 45, percent: 90, grade: 'A+' })
    expect(card.body).toMatchObject({ totalScore: 45, totalMax: 50, overallPercent: 90, overallGrade: 'A+', className: 'Grade 8-A' })
  })

  it('grade boundaries and absent students are handled', async () => {
    const id = await newExam('Edge', 'Hindi', 100)
    await c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 39.5 }, { studentId: w.u.student2, absent: true }] })
    await c.teacher.post(`/exams/${id}/submit`)
    await c.principal.post('/exams/bulk-approve', { ids: [id], decision: 'approve' })
    const card = await c.student.get(`/results/student/${w.u.student}`)
    expect(card.body.results.find((r: any) => r.subject === 'Hindi')).toMatchObject({ percent: 39.5, grade: 'F' })
    const other = await prisma.user.findUnique({ where: { id: w.u.student2 } })
    expect(other).toBeTruthy()
  })

  it('are private: own, linked child, or school staff only', async () => {
    expect((await c.student.get(`/results/student/${w.u.student2}`)).status).toBe(403)
    expect((await c.parent.get(`/results/student/${w.u.student}`)).status).toBe(200)
    expect((await c.parent.get(`/results/student/${w.u.student2}`)).status).toBe(403)
    expect((await c.principal.get(`/results/student/${w.u.student}`)).status).toBe(200)
    expect((await c.teacher.get(`/results/student/${w.u.student}`)).status).toBe(403)
  })
})
