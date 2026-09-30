import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>
let port: number
const sockets: Socket[] = []

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
  await app.listen(0)
  port = (app.getHttpServer().address() as { port: number }).port
})
afterAll(async () => { sockets.forEach((s) => s.close()); await app.close(); await prisma.$disconnect() })

type Cl = (typeof c)['student']
const open = async (who: Cl, userId: string) => (await who.post('/messages/conversations', { userId })).body.id as string
const send = (who: Cl, convId: string, body: string, extra: object = {}) => who.post(`/messages/conversations/${convId}`, { body, ...extra })
const connect = (token: string) => new Promise<Socket>((resolve) => { const s = io(`http://localhost:${port}`, { auth: { token }, reconnection: false }); sockets.push(s); s.on('connect', () => resolve(s)) })
const next = (s: Socket, event: string, ms = 2500) => new Promise<any>((r) => { s.once(event, r); setTimeout(() => r('timeout'), ms) })
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')
const upload = (who: Cl, convId: string, data: Buffer = PDF, name = 'notes.pdf') =>
  request(app.getHttpServer()).post(`/api/messages/conversations/${convId}/attachments`).set('authorization', `Bearer ${who.token}`).attach('file', data, name)
const download = (who: Cl, attachmentId: string) => who.get(`/messages/attachments/${attachmentId}`)

describe('direct messages: attachments', () => {
  it('sends a file with no text, and only the two people can download it', async () => {
    const id = await open(c.student, w.u.teacher)
    const up = await upload(c.student, id)
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ name: 'notes.pdf', mime: 'application/pdf' })
    // Not visible to anyone until the message is sent.
    expect((await download(c.teacher, up.body.id)).status).toBe(404)

    const sent = await send(c.student, id, '', { attachmentIds: [up.body.id] })
    expect(sent.status).toBe(201)
    expect(sent.body.attachments).toHaveLength(1)
    const got = await download(c.teacher, up.body.id)
    expect(got.status).toBe(200)
    expect(got.headers['content-type']).toBe('application/pdf')
    expect(got.headers['content-disposition']).toMatch(/attachment/)
    expect(got.headers['x-content-type-options']).toBe('nosniff')
    expect((await download(c.student, up.body.id)).status).toBe(200)
    for (const r of ['student2', 'parent', 'teacher2', 'clerk', 'principal', 'admin'] as const) expect((await download(c[r], up.body.id)).status, r).toBe(404)
  })

  it('rejects files that are not what they claim, and refuses empty messages', async () => {
    const id = await open(c.student, w.u.teacher)
    expect((await upload(c.student, id, Buffer.from('MZ this is a program'), 'trick.pdf')).status).toBe(400)
    expect((await upload(c.student, id, Buffer.from('x'), 'tool.exe')).status).toBe(400)
    expect((await send(c.student, id, '   ')).status).toBe(400)
  })

  it("cannot send someone else's upload, and unsent uploads can be taken back and are capped", async () => {
    const id = await open(c.student, w.u.teacher)
    const mine = await upload(c.student, id)
    expect((await send(c.teacher, id, 'hi', { attachmentIds: [mine.body.id] })).status).toBe(400)
    expect((await c.teacher.delete(`/messages/attachments/${mine.body.id}`)).status).toBe(404)
    expect((await c.student.delete(`/messages/attachments/${mine.body.id}`)).status).toBe(200)
    expect((await send(c.student, id, 'x', { attachmentIds: [mine.body.id] })).status).toBe(400)
    for (let i = 0; i < 5; i++) expect((await upload(c.student, id)).status).toBe(201)
    expect((await upload(c.student, id)).status).toBe(400)
  })

  it('deleting a message erases its files', async () => {
    const id = await open(c.student2, w.u.teacher)
    const up = await upload(c.student2, id)
    const m = await send(c.student2, id, 'see attached', { attachmentIds: [up.body.id] })
    expect((await download(c.teacher, up.body.id)).status).toBe(200)
    expect((await c.student2.delete(`/messages/message/${m.body.id}`)).status).toBe(200)
    expect((await download(c.teacher, up.body.id)).status).toBe(404)
    expect(await prisma.dmAttachment.count({ where: { messageId: m.body.id } })).toBe(0)
  })
})

describe('direct messages: edit and delete', () => {
  it('the sender can edit within 15 minutes; it is marked edited, and pushed live to both', async () => {
    const id = await open(c.clerk, w.u.student)
    const clerkSock = await connect(c.clerk.token)
    const m = await send(c.student, id, 'Helo there')
    const live = next(clerkSock, 'dm:updated')
    const r = await c.student.put(`/messages/message/${m.body.id}`, { body: 'Hello there' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ body: 'Hello there', edited: true })
    expect((await live).message).toMatchObject({ body: 'Hello there', edited: true, mine: false })
    const thread = (await c.clerk.get(`/messages/conversations/${id}`)).body
    expect(thread.messages.at(-1)).toMatchObject({ body: 'Hello there', edited: true })

    expect((await c.clerk.put(`/messages/message/${m.body.id}`, { body: 'hijack' })).status).toBe(403)
    await prisma.directMessage.update({ where: { id: m.body.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } })
    expect((await c.student.put(`/messages/message/${m.body.id}`, { body: 'too late' })).status).toBe(403)
  })

  it('the sender can delete any time; a placeholder remains, it stops counting as unread, and both are told live', async () => {
    const id = await open(c.principal, w.u.student)
    const principalSock = await connect(c.principal.token)
    const m = await send(c.student, id, 'Oops wrong chat')
    expect((await c.principal.get('/messages/unread')).body.count).toBeGreaterThanOrEqual(1)
    const live = next(principalSock, 'dm:deleted')
    expect((await c.principal.delete(`/messages/message/${m.body.id}`)).status).toBe(403) // not theirs
    expect((await c.student.delete(`/messages/message/${m.body.id}`)).status).toBe(200)
    expect(await live).toMatchObject({ conversationId: id, messageId: m.body.id })

    const row = await prisma.directMessage.findUniqueOrThrow({ where: { id: m.body.id } })
    expect(row.body).toBe('')
    const thread = (await c.principal.get(`/messages/conversations/${id}`)).body
    expect(thread.messages.at(-1)).toMatchObject({ deleted: true, body: '' })
    const list = (await c.principal.get('/messages/conversations')).body.find((x: any) => x.id === id)
    expect(list.lastMessage.body).toBe('Message deleted')
    expect(list.unread).toBe(0)
    expect((await c.student.delete(`/messages/message/${m.body.id}`)).status).toBe(400) // already deleted
  })
})

describe('direct messages: read receipts and typing', () => {
  it('shows when the other person has read, live', async () => {
    const id = await open(c.student, w.u.teacher)
    const studentSock = await connect(c.student.token)
    await send(c.student, id, 'Did you get my homework?')
    expect((await c.student.get(`/messages/conversations/${id}`)).body.otherReadAt).toBeNull()
    const seen = next(studentSock, 'dm:read')
    await c.teacher.get(`/messages/conversations/${id}`) // opening the thread reads it
    expect((await seen).conversationId).toBe(id)
    const after = (await c.student.get(`/messages/conversations/${id}`)).body
    expect(new Date(after.otherReadAt).getTime()).toBeGreaterThan(0)
  })

  it('passes "is typing" to the other person only, and not more than once a second', async () => {
    const id = await open(c.student2, w.u.teacher)
    const teacher = await connect(c.teacher.token), outsider = await connect(c.parent.token), sender = await connect(c.student2.token)
    const got = next(teacher, 'dm:typing'), leaked = next(outsider, 'dm:typing', 700)
    sender.emit('dm:typing', { conversationId: id })
    expect(await got).toMatchObject({ conversationId: id, userId: w.u.student2 })
    expect(await leaked).toBe('timeout')
    let extra = 0
    teacher.on('dm:typing', () => { extra++ })
    sender.emit('dm:typing', { conversationId: id }); sender.emit('dm:typing', { conversationId: id })
    await new Promise((r) => setTimeout(r, 400))
    expect(extra).toBe(0) // both fell inside the one-second window
    // A conversation you are not in is ignored.
    const spy = next(teacher, 'dm:typing', 700)
    outsider.emit('dm:typing', { conversationId: id })
    expect(await spy).toBe('timeout')
  })
})

describe('direct messages: email and WhatsApp copy', () => {
  const copies = (userId: string, channel = 'email', conversationId?: string) => prisma.notification.findMany({ where: { userId, event: 'dm.received', channel, ...(conversationId ? { ref: `dm:${conversationId}` } : {}) } })

  it('copies a message by email when the person is away, once per 10 minutes per conversation', async () => {
    const id = await open(c.principal, w.u.teacher2) // teacher2 has never had the app open in these tests
    await send(c.principal, id, 'Please prepare the term fee list')
    const first = await copies(w.u.teacher2)
    expect(first).toHaveLength(1)
    expect(first[0].body).toMatch(/principal wrote/)
    expect(first[0].body).toMatch(/Please prepare the term fee list/)
    expect(first[0].ref).toBe(`dm:${id}`)
    await send(c.principal, id, 'And the receipts too')
    expect(await copies(w.u.teacher2)).toHaveLength(1) // throttled

    // Ten minutes later a new burst is copied again.
    await prisma.notification.updateMany({ where: { userId: w.u.teacher2, ref: `dm:${id}` }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } })
    await send(c.principal, id, 'Any update?')
    expect(await copies(w.u.teacher2)).toHaveLength(2)
  })

  it('does not copy when the person is in the app, or has turned email off, and says so for attachments', async () => {
    const id = await open(c.clerk, w.u.teacher2)
    const teacher2 = await connect(c.teacher2.token)
    await send(c.clerk, id, 'Live message')
    expect(await copies(w.u.teacher2, 'email', id)).toHaveLength(0) // they had the app open
    teacher2.close()
    await new Promise((r) => setTimeout(r, 300))

    await prisma.notificationPreference.create({ data: { userId: w.u.teacher2, channel: 'email', enabled: false } })
    await send(c.clerk, id, 'Message while email is off')
    expect(await copies(w.u.teacher2, 'email', id)).toHaveLength(0)
    await prisma.notificationPreference.deleteMany({ where: { userId: w.u.teacher2 } })

    const up = await upload(c.clerk, id)
    await send(c.clerk, id, '', { attachmentIds: [up.body.id] })
    const now = await copies(w.u.teacher2, 'email', id)
    expect(now).toHaveLength(1)
    expect(now[0].body).toMatch(/1 attachment/)
  })
})

describe('direct messages: blocking', () => {
  it('stops both sides from messaging, hides them from contacts, and can be undone', async () => {
    const id = await open(c.student, w.u.teacher)
    expect((await c.teacher.post('/messages/blocks', { userId: w.u.student })).status).toBe(201)
    expect((await send(c.student, id, 'hello?')).status).toBe(403)
    expect((await send(c.teacher, id, 'hello')).status).toBe(403) // the blocker cannot write either
    expect((await c.student.get('/messages/contacts')).body.map((p: any) => p.id)).not.toContain(w.u.teacher)
    expect((await c.teacher.get('/messages/contacts')).body.map((p: any) => p.id)).not.toContain(w.u.student)
    const thread = (await c.teacher.get(`/messages/conversations/${id}`)).body
    expect(thread).toMatchObject({ blockedByMe: true, canReply: false })
    expect((await c.student.get(`/messages/conversations/${id}`)).body).toMatchObject({ blockedByMe: false, canReply: false })
    expect((await c.teacher.get('/messages/blocks')).body.map((p: any) => p.id)).toEqual([w.u.student])

    expect((await c.teacher.delete(`/messages/blocks/${w.u.student}`)).status).toBe(200)
    expect((await send(c.student, id, 'hello again')).status).toBe(201)
  })

  it('the principal and admin cannot be blocked, and you cannot block yourself', async () => {
    expect((await c.student.post('/messages/blocks', { userId: w.u.principal })).status).toBe(403)
    expect((await c.student.post('/messages/blocks', { userId: w.u.admin })).status).toBe(403)
    expect((await c.student.post('/messages/blocks', { userId: w.u.student })).status).toBe(400)
  })
})

describe('direct messages: reports and review', () => {
  it('a report lets the principal read that one conversation, is audited, and freezes it while open', async () => {
    const id = await open(c.student2, w.u.teacher)
    const rude = await send(c.student2, id, 'A message someone will complain about')
    // Before any report the principal can read nothing.
    expect((await c.principal.get('/messages/reports')).body).toEqual([])
    expect((await c.principal.get(`/messages/conversations/${id}`)).status).toBe(404)

    const rep = await c.teacher.post(`/messages/conversations/${id}/report`, { reason: 'This is not appropriate', messageId: rude.body.id })
    expect(rep.status).toBe(201)
    expect((await c.teacher.post(`/messages/conversations/${id}/report`, { reason: 'Again please' })).status).toBe(400)
    expect((await c.teacher.get(`/messages/conversations/${id}`)).body.reported).toBe(true)
    expect((await c.student2.get(`/messages/conversations/${id}`)).body.reported).toBe(true)
    expect((await prisma.notification.findMany({ where: { userId: w.u.principal, event: 'dm.reported' } })).length).toBeGreaterThan(0)

    // Frozen: nobody can edit or delete while the report is open.
    expect((await c.student2.delete(`/messages/message/${rude.body.id}`)).status).toBe(403)
    expect((await c.student2.put(`/messages/message/${rude.body.id}`, { body: 'rewritten' })).status).toBe(403)

    const list = (await c.principal.get('/messages/reports?status=open')).body
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: 'open', reason: 'This is not appropriate', reporter: { id: w.u.teacher }, reported: { id: w.u.student2 } })
    const detail = await c.principal.get(`/messages/reports/${rep.body.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.messages.map((m: any) => m.body)).toContain('A message someone will complain about')
    expect(detail.body.flaggedMessageId).toBe(rude.body.id)
    expect(await prisma.auditLog.count({ where: { action: 'message.report_viewed', actorId: w.u.principal } })).toBe(1)

    for (const r of ['student', 'parent', 'teacher', 'teacher2', 'clerk'] as const) expect((await c[r].get('/messages/reports')).status, r).toBe(403)
    // The admin is not the reviewer for a conversation the principal is not in.
    expect((await c.admin.get('/messages/reports')).body).toEqual([])
    expect((await c.admin.get(`/messages/reports/${rep.body.id}`)).status).toBe(404)

    const done = await c.principal.put(`/messages/reports/${rep.body.id}`, { status: 'reviewed', note: 'Spoke to the student' })
    expect(done.status).toBe(200)
    expect((await c.principal.put(`/messages/reports/${rep.body.id}`, { status: 'dismissed' })).status).toBe(400)
    expect((await prisma.notification.findMany({ where: { userId: w.u.teacher, event: 'dm.report_reviewed' } })).length).toBe(1)
    // Unfrozen again.
    expect((await c.student2.put(`/messages/message/${rude.body.id}`, { body: 'I apologise' })).status).toBe(200)
  })

  it('a reviewer can download files in a reported conversation, and only then', async () => {
    const id = await open(c.parent, w.u.teacher) // a conversation with no waiting uploads
    const up = await upload(c.parent, id)
    expect(up.status).toBe(201)
    await send(c.parent, id, 'file', { attachmentIds: [up.body.id] })
    expect((await download(c.principal, up.body.id)).status).toBe(404)
    await c.teacher.post(`/messages/conversations/${id}/report`, { reason: 'Please look at this file' })
    expect((await download(c.principal, up.body.id)).status).toBe(200)
    expect(await prisma.auditLog.count({ where: { action: 'message.attachment_viewed' } })).toBe(1)
  })

  it('nobody reviews a complaint about themselves: the admin handles conversations with the principal', async () => {
    const id = await open(c.principal, w.u.student)
    await send(c.principal, id, 'A private word')
    const rep = await c.student.post(`/messages/conversations/${id}/report`, { reason: 'I felt uncomfortable' })
    expect(rep.status).toBe(201)
    // The principal is a participant, so they cannot see or handle it.
    expect((await c.principal.get('/messages/reports?status=open')).body.map((r: any) => r.id)).not.toContain(rep.body.id)
    expect((await c.principal.get(`/messages/reports/${rep.body.id}`)).status).toBe(404)
    expect((await c.principal.put(`/messages/reports/${rep.body.id}`, { status: 'dismissed' })).status).toBe(404)
    // The admin can.
    expect((await c.admin.get('/messages/reports?status=open')).body.map((r: any) => r.id)).toContain(rep.body.id)
    expect((await c.admin.get(`/messages/reports/${rep.body.id}`)).status).toBe(200)
    expect((await prisma.notification.findMany({ where: { userId: w.u.admin, event: 'dm.reported' } })).length).toBeGreaterThan(0)
    expect((await c.admin.put(`/messages/reports/${rep.body.id}`, { status: 'dismissed', note: 'No issue found' })).status).toBe(200)
  })
})

describe('direct messages: which child a parent means', () => {
  it('tags a parent with one child automatically, and shows the children the parent can pick from', async () => {
    const id = await open(c.parent, w.u.teacher)
    const m = await send(c.parent, id, 'Will he need a calculator tomorrow?')
    expect(m.status).toBe(201)
    expect(m.body.about).toMatchObject({ id: w.u.student, name: 'student' })
    const thread = (await c.teacher.get(`/messages/conversations/${id}`)).body
    expect(thread.messages.at(-1).about).toMatchObject({ name: 'student' })
    expect(thread.kids.map((k: any) => k.id)).toEqual([w.u.student])
  })

  it('makes a parent with several children choose, and only accepts their own children', async () => {
    await prisma.parentStudentLink.create({ data: { schoolId: w.schoolId, parentId: w.u.parent, studentId: w.u.student2, relationship: 'mother', status: 'approved' } })
    // Fresh login so the new link is in scope (scope is reloaded on every request anyway).
    const id = await open(c.parent, w.u.teacher)
    expect((await send(c.parent, id, 'Question about homework')).status).toBe(400)
    expect((await send(c.parent, id, 'Question about homework', { aboutStudentId: w.u.student2 })).body.about).toMatchObject({ id: w.u.student2 })
    expect((await send(c.parent, id, 'x', { aboutStudentId: w.u.teacher2 })).status).toBe(400)
    expect((await c.parent.get(`/messages/conversations/${id}`)).body.kids.map((k: any) => k.id).sort()).toEqual([w.u.student, w.u.student2].sort())
    // The teacher can tag a child too when writing to the parent, but only one of the parent's.
    expect((await send(c.teacher, id, 'About Ben', { aboutStudentId: w.u.student2 })).body.about).toMatchObject({ id: w.u.student2 })
    expect((await send(c.teacher, id, 'Wrong', { aboutStudentId: w.u.teacher2 })).status).toBe(400)
  })

  it('only conversations with a parent can be about a child', async () => {
    const id = await open(c.student, w.u.teacher)
    expect((await send(c.student, id, 'hi', { aboutStudentId: w.u.student })).status).toBe(400)
  })
})
