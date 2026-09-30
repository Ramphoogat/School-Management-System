import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>
let yearId: string

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  await seedWorld('B')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const year = { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31' }

describe('academic calendar', () => {
  it('only principal and admin change it; everyone signed in can read', async () => {
    for (const r of ['teacher', 'student', 'parent', 'clerk'] as const) expect((await c[r].post('/academic/years', year)).status, r).toBe(403)
    const made = await c.principal.post('/academic/years', year)
    expect(made.status).toBe(201)
    yearId = made.body.id
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'admin'] as const) expect((await c[r].get('/academic')).status, r).toBe(200)
    const o = (await c.student.get('/academic')).body
    expect(o.years[0]).toMatchObject({ name: '2026-27', current: true, terms: [] })
  })

  it('rejects bad, duplicate and overlapping years', async () => {
    expect((await c.principal.post('/academic/years', { ...year, name: 'Backwards', startDate: '2027-01-01', endDate: '2026-01-01' })).status).toBe(400)
    expect((await c.principal.post('/academic/years', { ...year, name: 'x', startDate: 'soon' })).status).toBe(400)
    expect((await c.principal.post('/academic/years', year)).status).toBe(409)
    expect((await c.principal.post('/academic/years', { name: 'Clash', startDate: '2026-12-01', endDate: '2027-05-01' })).status).toBe(400)
  })

  it('terms stay inside the year and do not overlap', async () => {
    expect((await c.principal.post(`/academic/years/${yearId}/terms`, { name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-30' })).status).toBe(201)
    expect((await c.principal.post(`/academic/years/${yearId}/terms`, { name: 'Term 1', startDate: '2026-10-01', endDate: '2026-12-31' })).status).toBe(409)
    expect((await c.principal.post(`/academic/years/${yearId}/terms`, { name: 'Term 2', startDate: '2026-09-15', endDate: '2026-12-31' })).status).toBe(400)
    expect((await c.principal.post(`/academic/years/${yearId}/terms`, { name: 'Outside', startDate: '2027-04-01', endDate: '2027-05-01' })).status).toBe(400)
    expect((await c.principal.post(`/academic/years/${yearId}/terms`, { name: 'Term 2', startDate: '2026-10-01', endDate: '2026-12-31' })).status).toBe(201)
    expect((await c.teacher.post(`/academic/years/${yearId}/terms`, { name: 'Term 3', startDate: '2027-01-01', endDate: '2027-03-01' })).status).toBe(403)
  })

  it('exactly one year is current, and another school cannot touch it', async () => {
    const second = await c.admin.post('/academic/years', { name: '2027-28', startDate: '2027-06-01', endDate: '2028-03-31' })
    expect((await c.admin.get('/academic')).body.years.filter((y: any) => y.current).map((y: any) => y.name)).toEqual(['2026-27'])
    expect((await c.admin.post(`/academic/years/${second.body.id}/current`)).status).toBe(201)
    expect((await c.admin.get('/academic')).body.years.filter((y: any) => y.current).map((y: any) => y.name)).toEqual(['2027-28'])
    const b = await clients(app, 'b')
    expect((await b.principal.post(`/academic/years/${yearId}/current`)).status).toBe(404)
    expect((await b.principal.delete(`/academic/years/${yearId}`)).status).toBe(404)
    expect((await b.principal.get('/academic')).body.years).toEqual([])
  })
})

describe('exams and terms', () => {
  it('an exam joins the term its date falls in, or the term you name, and the report card can be filtered by term', async () => {
    const terms = (await c.student.get('/academic')).body.years.find((y: any) => y.id === yearId).terms
    const [t1, t2] = terms
    const mk = (body: object) => c.teacher.post('/exams', { classId: w.classA, subject: 'Maths', maxMarks: 100, ...body })
    const auto = await mk({ name: 'Unit 1', date: '2026-08-10' })
    expect(auto.body.termId).toBe(t1.id)
    const explicit = await mk({ name: 'Unit 2', date: '2026-08-11', termId: t2.id })
    expect(explicit.body.termId).toBe(t2.id)
    expect((await mk({ name: 'No term', date: '2025-01-01' })).body.termId).toBeNull()
    expect((await mk({ name: 'Bad', date: '2026-08-10', termId: 'nope' })).status).toBe(400)

    for (const [ex, score] of [[auto.body.id, 85], [explicit.body.id, 45]] as const) {
      await prisma.exam.update({ where: { id: ex }, data: { status: 'approved' } })
      await prisma.mark.create({ data: { examId: ex, studentId: w.u.student, score } })
    }
    const all = (await c.student.get(`/results/student/${w.u.student}`)).body
    expect(all.results.map((r: any) => r.grade).sort()).toEqual(['A', 'E'])
    const onlyT2 = (await c.student.get(`/results/student/${w.u.student}?termId=${t2.id}`)).body
    expect(onlyT2.results.map((r: any) => r.exam)).toEqual(['Unit 2'])
    expect(onlyT2.overallPercent).toBe(45)
  })

  it('a term or year with exams cannot be deleted', async () => {
    const t1 = (await c.student.get('/academic')).body.years.find((y: any) => y.id === yearId).terms[0]
    expect((await c.principal.delete(`/academic/terms/${t1.id}`)).status).toBe(409)
    expect((await c.principal.delete(`/academic/years/${yearId}`)).status).toBe(409)
  })
})

describe('grade scale', () => {
  const bands = [{ minPercent: 75, grade: 'Distinction' }, { minPercent: 40, grade: 'Pass' }, { minPercent: 0, grade: 'Fail' }]

  it('starts as the built-in scale and can be replaced by principal or admin only', async () => {
    const d = (await c.student.get('/academic/grade-scale')).body
    expect(d.isDefault).toBe(true)
    expect(d.bands[0]).toEqual({ minPercent: 90, grade: 'A+' })
    for (const r of ['teacher', 'student', 'clerk'] as const) expect((await c[r].put('/academic/grade-scale', { bands })).status, r).toBe(403)
    expect((await c.principal.put('/academic/grade-scale', { bands })).status).toBe(200)
    expect((await c.student.get('/academic/grade-scale')).body).toMatchObject({ isDefault: false, bands })
  })

  it('report cards use the new scale straight away', async () => {
    const card = (await c.parent.get(`/results/student/${w.u.student}`)).body
    expect(card.results.map((r: any) => r.grade).sort()).toEqual(['Distinction', 'Pass'])
    expect(card.overallGrade).toBe('Pass') // 130 / 200 = 65%
  })

  it('rejects scales that would leave marks ungraded or ambiguous', async () => {
    const put = (b: object[]) => c.principal.put('/academic/grade-scale', { bands: b })
    expect((await put([{ minPercent: 50, grade: 'P' }, { minPercent: 10, grade: 'F' }])).status).toBe(400) // no band at 0
    expect((await put([{ minPercent: 0, grade: 'A' }, { minPercent: 0, grade: 'B' }])).status).toBe(400) // same start
    expect((await put([{ minPercent: 0, grade: 'A' }, { minPercent: 50, grade: 'a' }])).status).toBe(400) // same grade
    expect((await put([{ minPercent: 0, grade: 'A' }])).status).toBe(400) // too few
    expect((await put([{ minPercent: 0, grade: 'F' }, { minPercent: 101, grade: 'A' }])).status).toBe(400)
    expect((await put([{ minPercent: 0, grade: 'Way too long!!!' }, { minPercent: 50, grade: 'A' }])).status).toBe(400)
    expect((await c.student.get('/academic/grade-scale')).body.bands).toEqual(bands) // unchanged by the failures
  })

  it('can be reset to the built-in scale', async () => {
    expect((await c.teacher.delete('/academic/grade-scale')).status).toBe(403)
    expect((await c.admin.delete('/academic/grade-scale')).status).toBe(200)
    expect((await c.student.get('/academic/grade-scale')).body.isDefault).toBe(true)
    expect((await c.parent.get(`/results/student/${w.u.student}`)).body.results.map((r: any) => r.grade).sort()).toEqual(['A', 'E'])
  })
})
