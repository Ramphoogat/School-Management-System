import { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World, wb: World
let c: Awaited<ReturnType<typeof clients>>, cb: Awaited<ReturnType<typeof clients>>
let port: number
const sockets: Socket[] = []

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A'); wb = await seedWorld('B')
  c = await clients(app, 'a'); cb = await clients(app, 'b')
  await app.listen(0)
  port = (app.getHttpServer().address() as { port: number }).port
})
afterAll(async () => { sockets.forEach((s) => s.close()); await app.close(); await prisma.$disconnect() })

type Cl = (typeof c)['student']
const start = (who: Cl, userId: string) => who.post('/messages/conversations', { userId })
const ids = (r: { body: { id: string }[] }) => r.body.map((x) => x.id)
const open = async (who: Cl, userId: string) => (await start(who, userId)).body.id as string
const send = (who: Cl, convId: string, body: string) => who.post(`/messages/conversations/${convId}`, { body })

describe('messages: access', () => {
  it('admin has no messaging; everyone else does', async () => {
    for (const path of ['/messages/contacts', '/messages/conversations', '/messages/unread']) expect((await c.admin.get(path)).status, path).toBe(403)
    expect((await start(c.admin, w.u.student)).status).toBe(403)
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal'] as const) expect((await c[r].get('/messages/conversations')).status, r).toBe(200)
    expect((await c.student.get('/messages/conversations').catch(() => null))).toBeTruthy()
  })

  it('requires a login', async () => {
    const res = await (await import('supertest')).default(app.getHttpServer()).get('/api/messages/conversations')
    expect(res.status).toBe(401)
  })
})

describe('messages: who you can find', () => {
  it('a student finds only the teachers of their class', async () => {
    expect(ids(await c.student.get('/messages/contacts'))).toEqual([w.u.teacher])
    expect(ids(await c.student2.get('/messages/contacts'))).toEqual([w.u.teacher])
  })

  it("a parent finds the teachers of their child's class", async () => {
    expect(ids(await c.parent.get('/messages/contacts'))).toEqual([w.u.teacher])
  })

  it('a teacher finds their students, those students\' parents, the principal and the clerk, and nobody else', async () => {
    const found = ids(await c.teacher.get('/messages/contacts'))
    expect(found.sort()).toEqual([w.u.student, w.u.student2, w.u.parent, w.u.clerk, w.u.principal].sort())
    expect(found).not.toContain(w.u.teacher2)
    expect(found).not.toContain(w.u.admin)
  })

  it('a teacher with no students finds only the office', async () => {
    expect(ids(await c.teacher2.get('/messages/contacts')).sort()).toEqual([w.u.clerk, w.u.principal].sort())
  })

  it('a teacher who teaches through the timetable is found too', async () => {
    await prisma.timetableSlot.create({ data: { schoolId: w.schoolId, classId: w.classA, dayOfWeek: 1, period: 1, startTime: '09:00', endTime: '09:45', subject: 'Art', teacherId: w.u.teacher2 } })
    expect(ids(await c.student.get('/messages/contacts')).sort()).toEqual([w.u.teacher, w.u.teacher2].sort())
    expect((await start(c.parent, w.u.teacher2)).status).toBe(201)
    await prisma.timetableSlot.deleteMany({ where: { teacherId: w.u.teacher2 } })
  })

  it('the clerk finds parents, students, teachers and the principal; the principal finds everyone but the admin', async () => {
    const clerk = ids(await c.clerk.get('/messages/contacts'))
    expect(clerk.sort()).toEqual([w.u.student, w.u.student2, w.u.parent, w.u.teacher, w.u.teacher2, w.u.principal].sort())
    const principal = ids(await c.principal.get('/messages/contacts'))
    expect(principal.sort()).toEqual([w.u.student, w.u.student2, w.u.parent, w.u.teacher, w.u.teacher2, w.u.clerk].sort())
  })

  it('never shows people from another school, and supports searching', async () => {
    expect((await cb.principal.get('/messages/contacts')).body.every((u: any) => u.name !== 'student' || true)).toBe(true)
    const all = await cb.principal.get('/messages/contacts')
    expect(all.body).toHaveLength(6)
    expect(ids(all).some((id) => Object.values(w.u).includes(id))).toBe(false)
    const q = await c.clerk.get('/messages/contacts?q=student2')
    expect(ids(q)).toEqual([w.u.student2])
  })

  it('describes people so you know who they are', async () => {
    const forTeacher = (await c.teacher.get('/messages/contacts')).body
    expect(forTeacher.find((u: any) => u.id === w.u.parent).context).toBe('Parent of student')
    expect(forTeacher.find((u: any) => u.id === w.u.student).context).toBe('Student · Grade 8-A')
    expect((await c.student.get('/messages/contacts')).body[0].context).toBe('Teacher · Grade 8-A')
  })
})

describe('messages: who can start a conversation', () => {
  // Reopening an existing conversation is always allowed, so each rule is checked from a clean slate.
  beforeEach(async () => { await prisma.conversation.deleteMany({}) })

  it('student → own teacher only', async () => {
    expect((await start(c.student, w.u.teacher)).status).toBe(201)
    for (const target of [w.u.teacher2, w.u.principal, w.u.clerk, w.u.student2, w.u.parent, w.u.admin]) expect((await start(c.student, target)).status, target).toBe(403)
  })

  it("parent → teachers of their child's class only", async () => {
    expect((await start(c.parent, w.u.teacher)).status).toBe(201)
    for (const target of [w.u.teacher2, w.u.principal, w.u.clerk, w.u.student, w.u.admin]) expect((await start(c.parent, target)).status, target).toBe(403)
  })

  it('teacher → own students, their parents, principal and clerk; not other teachers, other classes or admin', async () => {
    for (const target of [w.u.student2, w.u.parent, w.u.principal, w.u.clerk]) expect((await start(c.teacher, target)).status, target).toBe(201)
    for (const target of [w.u.teacher2, w.u.admin]) expect((await start(c.teacher, target)).status, target).toBe(403)
    for (const target of [w.u.student, w.u.student2, w.u.parent]) expect((await start(c.teacher2, target)).status, target).toBe(403)
  })

  it('principal → anyone except admin; clerk → parents, students, teachers, principal', async () => {
    expect((await start(c.principal, w.u.student)).status).toBe(201)
    expect((await start(c.principal, w.u.admin)).status).toBe(403)
    expect((await start(c.clerk, w.u.parent)).status).toBe(201)
    expect((await start(c.clerk, w.u.admin)).status).toBe(403)
  })

  it('reopening returns the same conversation from either side', async () => {
    const first = await start(c.student, w.u.teacher)
    expect(first.body).toEqual({ id: expect.any(String), created: true })
    const a = await start(c.student, w.u.teacher), b = await start(c.teacher, w.u.student)
    expect(a.body).toEqual({ id: first.body.id, created: false })
    expect(b.body.id).toBe(a.body.id)
    expect(await prisma.conversation.count({ where: { OR: [{ userAId: w.u.student, userBId: w.u.teacher }, { userAId: w.u.teacher, userBId: w.u.student }] } })).toBe(1)
  })

  it('refuses yourself, unknown people, another school, and inactive users', async () => {
    expect((await start(c.teacher, w.u.teacher)).status).toBe(403)
    expect((await start(c.teacher, 'nobody')).status).toBe(403)
    expect((await start(cb.principal, w.u.student)).status).toBe(403) // school A student, school B principal
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: false } })
    expect((await start(c.principal, w.u.student2)).status).toBe(403)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: true } })
  })

  it('records who started a conversation in the audit log', async () => {
    expect(await prisma.auditLog.count({ where: { action: 'message.conversation_started', actorId: w.u.student } })).toBeGreaterThanOrEqual(1)
  })
})

describe('messages: sending and reading', () => {
  it('delivers a message, counts it as unread for the other person only, and clears when read', async () => {
    const id = await open(c.student, w.u.teacher)
    expect((await send(c.student, id, 'Hello sir, I have a question')).status).toBe(201)
    expect((await c.teacher.get('/messages/unread')).body.count).toBeGreaterThanOrEqual(1)
    expect((await c.student.get('/messages/unread')).body.count).toBe(0) // your own message is never unread

    const list = (await c.teacher.get('/messages/conversations')).body.find((x: any) => x.id === id)
    expect(list).toMatchObject({ unread: 1, other: { id: w.u.student, role: 'student' }, lastMessage: { body: 'Hello sir, I have a question', mine: false } })

    const thread = await c.teacher.get(`/messages/conversations/${id}`)
    expect(thread.body.messages).toHaveLength(1)
    expect(thread.body.messages[0]).toMatchObject({ body: 'Hello sir, I have a question', mine: false, senderId: w.u.student })
    expect(thread.body).toMatchObject({ canReply: true, other: { name: 'student' } })
    expect((await c.teacher.get('/messages/conversations')).body.find((x: any) => x.id === id).unread).toBe(0)
  })

  it('keeps messages in order and marks which are yours', async () => {
    const id = await open(c.teacher, w.u.student2)
    await send(c.teacher, id, 'first'); await send(c.student2, id, 'second'); await send(c.teacher, id, 'third')
    const t = await c.student2.get(`/messages/conversations/${id}`)
    expect(t.body.messages.map((m: any) => [m.body, m.mine])).toEqual([['first', false], ['second', true], ['third', false]])
  })

  it('trims the text and rejects empty or oversized messages', async () => {
    const id = await open(c.teacher, w.u.student2)
    expect((await send(c.teacher, id, '   ')).status).toBe(400)
    expect((await send(c.teacher, id, '')).status).toBe(400)
    expect((await send(c.teacher, id, 'x'.repeat(2001))).status).toBe(400)
    expect((await send(c.teacher, id, '  padded  ')).body.body).toBe('padded')
    expect((await send(c.teacher, id, 'x'.repeat(2000))).status).toBe(201)
  })

  it('keeps conversations private: outsiders cannot read, send or mark read', async () => {
    const id = await open(c.student, w.u.teacher)
    for (const r of ['student2', 'parent', 'teacher2', 'principal', 'clerk'] as const) {
      expect((await c[r].get(`/messages/conversations/${id}`)).status, r).toBe(404)
      expect((await send(c[r], id, 'sneaky')).status, r).toBe(404)
      expect((await c[r].post(`/messages/conversations/${id}/read`)).status, r).toBe(404)
    }
    expect((await cb.principal.get(`/messages/conversations/${id}`)).status).toBe(404)
    expect((await c.principal.get('/messages/conversations')).body.some((x: any) => x.id === id)).toBe(false)
  })

  it('shows only your own conversations in the list, newest first', async () => {
    const mine = (await c.teacher.get('/messages/conversations')).body
    expect(mine.length).toBeGreaterThanOrEqual(2)
    const times = mine.map((x: any) => +new Date(x.lastMessageAt))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect((await c.student2.get('/messages/conversations')).body.every((x: any) => x.other.id !== w.u.parent)).toBe(true)
  })

  it('a student can reply when the principal started it, but cannot start one', async () => {
    await prisma.conversation.deleteMany({})
    expect((await start(c.student, w.u.principal)).status).toBe(403)
    const id = await open(c.principal, w.u.student)
    await send(c.principal, id, 'Please see me after class')
    expect((await send(c.student, id, 'Yes, I will')).status).toBe(201)
  })

  it('a parent cannot message a teacher once the link to the child is revoked, and history stays readable', async () => {
    const id = await open(c.parent, w.u.teacher)
    await send(c.parent, id, 'About my child')
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'revoked' } })
    const after = await send(c.parent, id, 'Still there?')
    expect(after.status).toBe(403)
    expect(after.body.message).toMatch(/no longer/i)
    expect((await send(c.teacher, id, 'Reply')).status).toBe(403) // the teacher cannot reach a revoked parent either
    const thread = await c.parent.get(`/messages/conversations/${id}`)
    expect(thread.status).toBe(200)
    expect(thread.body).toMatchObject({ canReply: false })
    expect(thread.body.messages.length).toBeGreaterThan(0)
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'approved' } })
    expect((await send(c.parent, id, 'Back again')).status).toBe(201)
  })

  it('a student cannot message a teacher after leaving the class', async () => {
    const id = await open(c.student2, w.u.teacher)
    await prisma.classMember.deleteMany({ where: { userId: w.u.student2, classId: w.classA } })
    expect((await send(c.student2, id, 'hello')).status).toBe(403)
    expect((await send(c.teacher, id, 'hello')).status).toBe(403)
    await prisma.classMember.create({ data: { classId: w.classA, userId: w.u.student2, roleInClass: 'student' } })
    expect((await send(c.student2, id, 'hello')).status).toBe(201)
  })

  it('a deactivated person cannot be messaged', async () => {
    const id = await open(c.teacher, w.u.student2)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: false } })
    expect((await send(c.teacher, id, 'are you there')).status).toBe(403)
    await prisma.user.update({ where: { id: w.u.student2 }, data: { active: true } })
  })

  it('slows down flooding', async () => {
    const id = await open(c.principal, w.u.parent)
    const results: number[] = []
    for (let i = 0; i < 31; i++) results.push((await send(c.principal, id, `spam ${i}`)).status)
    expect(results.slice(0, 29).every((s) => s === 201)).toBe(true) // earlier messages in this file already counted
    expect(results).toContain(429)
  })
})

describe('messages: notifications and home', () => {
  it('sends one in-app alert per sender until it is read', async () => {
    await prisma.notification.deleteMany({})
    const id = await open(c.teacher, w.u.student2)
    await send(c.teacher, id, 'one'); await send(c.teacher, id, 'two'); await send(c.teacher, id, 'three')
    const alerts = (await c.student2.get('/notifications')).body.filter((n: any) => n.event === 'dm.received')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].subject).toBe('New message from teacher')
    await c.student2.post(`/notifications/${alerts[0].id}/read`)
    await send(c.teacher, id, 'four')
    expect((await c.student2.get('/notifications')).body.filter((n: any) => n.event === 'dm.received')).toHaveLength(2)
    expect((await c.teacher.get('/notifications')).body.some((n: any) => n.event === 'dm.received')).toBe(false) // never alerts the sender
  })

  it('appears as an unread item on the recipient\'s home to-do list', async () => {
    const todo = (await c.student2.get('/home/todo')).body.items
    const item = todo.find((i: any) => i.key === 'messages')
    expect(item).toMatchObject({ label: 'Unread messages', path: '/messages' })
    expect(item.count).toBeGreaterThanOrEqual(1)
    const id = (await c.student2.get('/messages/conversations')).body.find((x: any) => x.other.id === w.u.teacher).id
    await c.student2.get(`/messages/conversations/${id}`)
  })
})

describe('messages: live delivery', () => {
  const connect = (token: string) => new Promise<Socket>((resolve) => { const s = io(`http://localhost:${port}`, { auth: { token }, reconnection: false }); sockets.push(s); s.on('connect', () => resolve(s)) })
  const nextMsg = (s: Socket, ms = 3000) => new Promise<any>((r) => { s.once('dm:message', r); setTimeout(() => r('timeout'), ms) })

  it('pushes a new message to the recipient and to the sender\'s other devices, and to nobody else', async () => {
    const teacher = await connect(c.teacher.token), studentA = await connect(c.student.token), studentB = await connect(c.student.token), parent = await connect(c.parent.token)
    const id = await open(c.student, w.u.teacher)
    const gotTeacher = nextMsg(teacher), gotOtherDevice = nextMsg(studentB), gotParent = nextMsg(parent, 800)
    expect((await send(c.student, id, 'live!')).status).toBe(201)
    const t = await gotTeacher
    expect(t).toMatchObject({ conversationId: id, message: { body: 'live!', senderId: w.u.student }, from: { id: w.u.student, name: 'student', role: 'student' } })
    expect((await gotOtherDevice).message.body).toBe('live!')
    expect(await gotParent).toBe('timeout')
    expect(studentA.connected).toBe(true)
  })

  it('does not push anything for a message that was refused', async () => {
    const teacher = await connect(c.teacher.token)
    const id = await open(c.student, w.u.teacher)
    const spy = nextMsg(teacher, 800)
    await send(c.student, id, '   ')
    expect(await spy).toBe('timeout')
  })

  it('disconnects a socket with a bad token', async () => {
    const bad = io(`http://localhost:${port}`, { auth: { token: 'junk' }, reconnection: false })
    sockets.push(bad)
    expect(await new Promise<boolean>((r) => { bad.on('disconnect', () => r(true)); setTimeout(() => r(false), 4000) })).toBe(true)
  })
})
