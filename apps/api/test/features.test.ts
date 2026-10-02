import { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
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

describe('announcements', () => {
  it('teachers post to their own class only; school-wide needs clerk, principal or admin', async () => {
    const own = { classId: w.classA, title: 'Trip', body: 'Bring lunch' }
    expect((await c.teacher.post('/announcements', own)).status).toBe(201)
    expect((await c.teacher2.post('/announcements', own)).status).toBe(403)
    expect((await c.teacher.post('/announcements', { title: 'All', body: 'Everyone' })).status).toBe(403)
    for (const r of ['student', 'parent'] as const) expect((await c[r].post('/announcements', own)).status, r).toBe(403)
    for (const r of ['clerk', 'principal', 'admin'] as const) expect((await c[r].post('/announcements', { title: `From ${r}`, body: 'Hello' })).status, r).toBe(201)
  })

  it('members and linked parents see class posts; outsiders do not', async () => {
    expect((await c.student.get(`/announcements?classId=${w.classA}`)).body.map((a: any) => a.title)).toContain('Trip')
    expect((await c.parent.get(`/announcements?classId=${w.classA}`)).status).toBe(200)
    expect((await c.teacher2.get(`/announcements?classId=${w.classA}`)).status).toBe(403)
    // A student in no class sees school-wide posts but not class posts.
    const loner = await prisma.user.create({ data: { schoolId: w.schoolId, email: 'loner@a.test', name: 'Loner', role: 'student', passwordHash: (await prisma.user.findFirst())!.passwordHash } })
    const { client, login } = await import('./helpers')
    const lc = client(app, await login(app, 'loner@a.test'))
    const titles = (await lc.get('/announcements')).body.map((a: any) => a.title)
    expect(titles).toContain('From principal')
    expect(titles).not.toContain('Trip')
    expect(loner.id).toBeTruthy()
  })

  it("respects the sender's channel choice: in-app is always queued; email only when chosen", async () => {
    await prisma.notification.deleteMany({})
    await c.teacher.post('/announcements', { classId: w.classA, title: 'Chan', body: 'x', channels: ['in_app'] })
    expect(await prisma.notification.count({ where: { event: 'announcement.posted', channel: 'email' } })).toBe(0)
    expect(await prisma.notification.count({ where: { event: 'announcement.posted', channel: 'in_app' } })).toBe(3) // student, student2, parent
    await c.teacher.post('/announcements', { classId: w.classA, title: 'Chan2', body: 'x', channels: ['email'] })
    expect(await prisma.notification.count({ where: { event: 'announcement.posted', channel: 'email' } })).toBe(3)
  })

  it('rejects unknown channels', async () => {
    expect((await c.teacher.post('/announcements', { classId: w.classA, title: 'T', body: 'B', channels: ['pigeon'] })).status).toBe(400)
  })
})

describe('homework', () => {
  const due = daysFromNow(3)
  it('teacher assigns; students submit; parents can view but not submit', async () => {
    const a = await c.teacher.post('/homework', { classIds: [w.classA], title: 'Fractions', description: 'Ex 4', dueDate: due })
    expect(a.status).toBe(201)
    const list = await c.student.get(`/homework?classId=${w.classA}`)
    expect(list.body).toHaveLength(1)
    const id = list.body[0].id
    expect((await c.student.post(`/homework/${id}/submit`, { text: '3/4' })).status).toBe(201)
    expect((await c.student.post(`/homework/${id}/submit`, { text: '4/5' })).status).toBe(201) // resubmit replaces
    expect(await prisma.submission.count({ where: { assignmentId: id } })).toBe(1)
    expect((await c.parent.get(`/homework?classId=${w.classA}`)).status).toBe(200)
    expect((await c.parent.post(`/homework/${id}/submit`, { text: 'mine' })).status).toBe(403)
    expect((await c.teacher.post(`/homework/${id}/submit`, { text: 'teacher' })).status).toBe(403)
  })

  it('a student outside the class cannot read or submit; teacher sees who submitted', async () => {
    const [{ id }] = (await c.teacher.get(`/homework?classId=${w.classA}`)).body
    const { client, login } = await import('./helpers')
    const outsider = client(app, await login(app, 'teacher2@a.test'))
    expect((await outsider.get(`/homework?classId=${w.classA}`)).status).toBe(403)
    const subs = await c.teacher.get(`/homework/${id}/submissions`)
    expect(subs.body.find((s: any) => s.studentId === w.u.student).text).toBe('4/5')
    expect(subs.body.find((s: any) => s.studentId === w.u.student2).submittedAt).toBeNull()
    expect((await c.student.get(`/homework/${id}/submissions`)).status).toBe(403)
  })

  it('bulk assign to several classes needs rights on every one of them', async () => {
    const both = { classIds: [w.classA, w.classB], title: 'Both', description: '', dueDate: due }
    expect((await c.teacher.post('/homework', both)).status).toBe(403) // teacher does not own class B
    expect(await prisma.assignment.count({ where: { title: 'Both' } })).toBe(0)
  })

  it('validates input', async () => {
    expect((await c.teacher.post('/homework', { classIds: [], title: 'x', description: '', dueDate: due })).status).toBe(400)
    expect((await c.teacher.post('/homework', { classIds: [w.classA], title: 'x', description: '', dueDate: 'soon' })).status).toBe(400)
  })
})

describe('timetable', () => {
  const slot = (o: object = {}) => ({ dayOfWeek: 1, period: 1, startTime: '09:00', endTime: '09:45', subject: 'Maths', ...o })
  it('principal and admin set it; everyone else cannot', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) expect((await c[r].put(`/timetable/class/${w.classA}`, { slots: [slot()] })).status, r).toBe(403)
    expect((await c.principal.put(`/timetable/class/${w.classA}`, { slots: [slot({ teacherId: w.u.teacher }), slot({ period: 2, startTime: '09:50', endTime: '10:35', subject: 'English' })] })).status).toBe(200)
    expect((await c.admin.put(`/timetable/class/${w.classA}`, { slots: [slot({ teacherId: w.u.teacher })] })).status).toBe(200)
  })

  it('rejects duplicate periods, backwards times, bad times and non-teachers', async () => {
    const put = (slots: object[]) => c.principal.put(`/timetable/class/${w.classA}`, { slots })
    expect((await put([slot(), slot({ subject: 'Dup' })])).status).toBe(400)
    expect((await put([slot({ startTime: '10:00', endTime: '09:00' })])).status).toBe(400)
    expect((await put([slot({ startTime: '9am' })])).status).toBe(400)
    expect((await put([slot({ dayOfWeek: 9 })])).status).toBe(400)
    expect((await put([slot({ teacherId: w.u.student })])).status).toBe(400)
  })

  it('is replaced atomically, and read by the right people', async () => {
    await c.principal.put(`/timetable/class/${w.classA}`, { slots: [slot({ teacherId: w.u.teacher })] })
    await c.principal.put(`/timetable/class/${w.classA}`, { slots: [slot({ subject: 'Science' })] }).then((r) => expect(r.body).toHaveLength(1))
    expect((await c.student.get('/timetable/me')).body.map((s: any) => s.subject)).toEqual(['Science'])
    expect((await c.parent.get('/timetable/me')).body).toHaveLength(1)
    expect((await c.student.get(`/timetable/class/${w.classA}`)).status).toBe(200)
    expect((await c.teacher2.get(`/timetable/class/${w.classA}`)).status).toBe(403)
  })
})

describe('certificates', () => {
  it('clerk issues in bulk with sequential numbers and reports unknown students', async () => {
    const res = await c.clerk.post('/certificates/bulk-issue', { studentIds: [w.u.student, w.u.student2, 'ghost', w.u.parent], type: 'bonafide' })
    expect(res.body).toMatchObject({ total: 4, succeeded: 2 })
    expect(res.body.results.filter((r: any) => r.ok).map((r: any) => r.number)).toEqual([expect.stringMatching(/^BON-\d{4}-0001$/), expect.stringMatching(/^BON-\d{4}-0002$/)])
    const tc = await c.clerk.post('/certificates/bulk-issue', { studentIds: [w.u.student], type: 'transfer' })
    expect(tc.body.results[0].number).toMatch(/^TC-\d{4}-0001$/)
  })

  it('only the clerk issues; validates type and size', async () => {
    for (const r of ['teacher', 'student', 'parent', 'principal', 'admin'] as const) {
      expect((await c[r].post('/certificates/bulk-issue', { studentIds: [w.u.student], type: 'bonafide' })).status, r).toBe(403)
    }
    expect((await c.clerk.post('/certificates/bulk-issue', { studentIds: [w.u.student], type: 'diploma' })).status).toBe(400)
    expect((await c.clerk.post('/certificates/bulk-issue', { studentIds: [], type: 'bonafide' })).status).toBe(400)
  })

  it('students and parents see only their own or their child\'s', async () => {
    expect((await c.student.get('/certificates')).body.every((x: any) => x.studentId === w.u.student)).toBe(true)
    expect((await c.student2.get('/certificates')).body.every((x: any) => x.studentId === w.u.student2)).toBe(true)
    expect((await c.parent.get('/certificates')).body.every((x: any) => x.studentId === w.u.student)).toBe(true)
    const other = await prisma.certificate.findFirst({ where: { studentId: w.u.student2 } })
    expect((await c.student.get(`/certificates/${other!.id}`)).status).toBe(403)
    expect((await c.parent.get(`/certificates/${other!.id}`)).status).toBe(403)
    expect((await c.clerk.get(`/certificates/${other!.id}`)).status).toBe(200)
    const own = await prisma.certificate.findFirst({ where: { studentId: w.u.student } })
    expect((await c.student.get(`/certificates/${own!.id}`)).body).toMatchObject({ studentName: 'student', schoolName: 'School A' })
  })
})

describe('class chat', () => {
  it('serves history to the class, its parents and school staff, and to nobody else', async () => {
    expect((await c.student.get(`/chat/${w.classA}`)).status).toBe(200)
    expect((await c.teacher.get(`/chat/${w.classA}`)).status).toBe(200)
    for (const r of ['principal', 'admin', 'clerk', 'parent'] as const) expect((await c[r].get(`/chat/${w.classA}`)).status, r).toBe(200)
    expect((await c.teacher2.get(`/chat/${w.classA}`)).status).toBe(403) // a teacher of another class
  })

  it('delivers live messages to joined members, refuses outsiders, and disconnects bad tokens', async () => {
    await app.listen(0)
    const port = (app.getHttpServer().address() as { port: number }).port
    const sockets: Socket[] = []
    const connect = (token: string) => new Promise<Socket>((resolve) => { const s = io(`http://localhost:${port}`, { auth: { token }, reconnection: false }); sockets.push(s); s.on('connect', () => resolve(s)); s.on('disconnect', () => resolve(s)) })
    const ack = (s: Socket, ev: string, d: object) => new Promise<any>((r) => s.emit(ev, d, r))
    try {
      const student = await connect(c.student.token), teacher = await connect(c.teacher.token), outsider = await connect(c.teacher2.token)
      expect(await ack(student, 'join', { classId: w.classA })).toEqual({ ok: true })
      expect(await ack(teacher, 'join', { classId: w.classA })).toEqual({ ok: true })
      expect((await ack(outsider, 'join', { classId: w.classA })).ok).toBe(false)

      const received = new Promise<any>((r) => student.on('message', r))
      expect((await ack(outsider, 'message', { classId: w.classA, body: 'let me in' })).ok).toBe(false)
      expect((await ack(teacher, 'message', { classId: w.classA, body: '  Welcome!  ' })).ok).toBe(true)
      const m = await Promise.race([received, new Promise((r) => setTimeout(() => r('timeout'), 4000))])
      expect(m).toMatchObject({ body: 'Welcome!', senderId: w.u.teacher, senderName: 'teacher' })
      expect(await prisma.chatMessage.count({ where: { classId: w.classA } })).toBe(1) // the outsider's attempt was not stored

      expect((await ack(teacher, 'message', { classId: w.classA, body: '   ' })).ok).toBe(false)
      expect((await ack(teacher, 'message', { classId: w.classB, body: 'wrong class' })).ok).toBe(false)

      const bad = io(`http://localhost:${port}`, { auth: { token: 'junk' }, reconnection: false })
      sockets.push(bad)
      const closed = await new Promise<boolean>((r) => { bad.on('disconnect', () => r(true)); setTimeout(() => r(false), 4000) })
      expect(closed).toBe(true)
    } finally {
      sockets.forEach((s) => s.close())
    }
  })
})
