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

const slot = (o: object = {}) => ({ dayOfWeek: 1, period: 1, startTime: '09:00', endTime: '09:45', subject: 'Maths', ...o })
const put = (classId: string, slots: object[]) => c.principal.put(`/timetable/class/${classId}`, { slots })

describe('timetable: clashes', () => {
  it('rejects overlapping periods within one class on the same day, but allows the same time on different days', async () => {
    const res = await put(w.classA, [slot(), slot({ period: 2, startTime: '09:30', endTime: '10:15', subject: 'English' })])
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/monday.*overlaps/i)
    expect((await put(w.classA, [slot(), slot({ dayOfWeek: 2, subject: 'English' })])).status).toBe(200)
    // Back-to-back is fine: one ends exactly when the next starts.
    expect((await put(w.classA, [slot(), slot({ period: 2, startTime: '09:45', endTime: '10:30', subject: 'English' })])).status).toBe(200)
  })

  it('refuses to book a teacher into two classes at the same time, and names the clash', async () => {
    await put(w.classA, [slot({ teacherId: w.u.teacher })])
    const clash = await put(w.classB, [slot({ startTime: '09:30', endTime: '10:15', teacherId: w.u.teacher })])
    expect(clash.status).toBe(400)
    expect(clash.body.message).toMatch(/teacher is already teaching Grade 8-A on Monday 09:00-09:45/)
    expect(await prisma.timetableSlot.count({ where: { classId: w.classB } })).toBe(0) // nothing was saved
  })

  it('allows the same teacher at different times, on different days, or in the same class again', async () => {
    expect((await put(w.classB, [slot({ startTime: '09:45', endTime: '10:30', teacherId: w.u.teacher })])).status).toBe(200)
    expect((await put(w.classB, [slot({ dayOfWeek: 3, teacherId: w.u.teacher })])).status).toBe(200)
    // Re-saving a class does not clash with its own old slots.
    expect((await put(w.classA, [slot({ teacherId: w.u.teacher }), slot({ dayOfWeek: 2, teacherId: w.u.teacher })])).status).toBe(200)
  })

  it('a slot without a teacher never clashes', async () => {
    expect((await put(w.classB, [slot()])).status).toBe(200)
  })
})

describe('timetable: reading', () => {
  it("shows staff every class's slots and a student only their class", async () => {
    await put(w.classA, [slot({ subject: 'Science', teacherId: w.u.teacher })])
    await put(w.classB, [slot({ subject: 'History', dayOfWeek: 2 })])
    const staff = await c.principal.get('/timetable/me')
    expect(staff.body.map((s: any) => s.className).sort()).toEqual(['Grade 8-A', 'Grade 9-B'])
    expect((await c.student.get('/timetable/me')).body.map((s: any) => s.subject)).toEqual(['Science'])
    expect((await c.parent.get('/timetable/me')).body.map((s: any) => s.subject)).toEqual(['Science'])
  })

  it("a teacher sees the classes they teach in and their own class", async () => {
    await put(w.classB, [slot({ subject: 'Physics', dayOfWeek: 4, teacherId: w.u.teacher })]) // teacher teaches class B but is not a member
    const mine = (await c.teacher.get('/timetable/me')).body
    expect(mine.map((s: any) => s.subject).sort()).toEqual(['Physics', 'Science'])
    expect(mine.find((s: any) => s.subject === 'Physics').className).toBe('Grade 9-B')
  })
})
