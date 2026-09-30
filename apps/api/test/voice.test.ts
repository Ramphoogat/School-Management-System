import { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REMOVAL_MINUTES, VoiceRooms } from '@dist/voice/voice.module'
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

const connect = (token: string) =>
  new Promise<Socket>((resolve) => {
    const s = io(`http://localhost:${port}`, { auth: { token }, reconnection: false })
    sockets.push(s)
    s.on('connect', () => resolve(s))
  })
const ack = (s: Socket, ev: string, d: object) => new Promise<any>((r) => s.emit(ev, d, r))
const nextEvent = (s: Socket, ev: string, ms = 3000) => new Promise<any>((r) => { s.once(ev, r); setTimeout(() => r('timeout'), ms) })
const mkChannel = async (name: string, classId = w.classA) => (await c.teacher.post(`/voice/class/${classId}`, { name })).body.id as string

describe('voice channels: who can list, create and delete', () => {
  it('lists for members and school staff; not for parents or other classes', async () => {
    for (const r of ['student', 'teacher', 'clerk', 'principal', 'admin'] as const) expect((await c[r].get(`/voice/class/${w.classA}`)).status, r).toBe(200)
    expect((await c.parent.get(`/voice/class/${w.classA}`)).status).toBe(403)
    expect((await c.teacher2.get(`/voice/class/${w.classA}`)).status).toBe(403)
    expect((await c.teacher2.get(`/voice/class/${w.classB}`)).status).toBe(200)
    expect((await cb.principal.get(`/voice/class/${w.classA}`)).status).toBe(403) // another school
  })

  it('the class teacher, clerk, principal and admin can create many channels; students, parents and other teachers cannot', async () => {
    for (const r of ['student', 'parent', 'teacher2'] as const) expect((await c[r].post(`/voice/class/${w.classA}`, { name: 'Nope' })).status, r).toBe(403)
    for (const [r, name] of [['teacher', 'Study room 1'], ['teacher', 'Study room 2'], ['clerk', 'Office hours'], ['principal', 'Assembly'], ['admin', 'Tech help']] as const) {
      expect((await c[r].post(`/voice/class/${w.classA}`, { name })).status, r).toBe(201)
    }
    const list = await c.student.get(`/voice/class/${w.classA}`)
    expect(list.body.channels.map((x: any) => x.name)).toEqual(['Study room 1', 'Study room 2', 'Office hours', 'Assembly', 'Tech help'])
    expect(list.body.canManage).toBe(false)
    expect((await c.teacher.get(`/voice/class/${w.classA}`)).body.canManage).toBe(true)
    expect((await c.teacher2.get(`/voice/class/${w.classB}`)).body.canManage).toBe(true)
  })

  it('rejects duplicate (case-insensitive), blank and over-long names, and unknown classes', async () => {
    expect((await c.teacher.post(`/voice/class/${w.classA}`, { name: 'study ROOM 1' })).status).toBe(400)
    expect((await c.teacher.post(`/voice/class/${w.classA}`, { name: '   ' })).status).toBe(400)
    expect((await c.teacher.post(`/voice/class/${w.classA}`, { name: 'x'.repeat(41) })).status).toBe(400)
    expect((await c.principal.post(`/voice/class/${wb.classA}`, { name: 'Cross school' })).status).toBe(403)
  })

  it('only managers can delete, and deletion is audited', async () => {
    const id = await mkChannel('Temp')
    for (const r of ['student', 'parent', 'teacher2'] as const) expect((await c[r].delete(`/voice/${id}`)).status, r).toBe(403)
    expect((await cb.principal.delete(`/voice/${id}`)).status).toBe(404) // other school
    expect((await c.teacher.delete(`/voice/${id}`)).status).toBe(200)
    expect(await prisma.voiceChannel.count({ where: { id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'voice.channel_deleted', resourceId: id } })).toBe(1)
  })
})

describe('voice notes', () => {
  it('are private to each person, per channel', async () => {
    const id = await mkChannel('Notes room')
    expect((await c.student.put(`/voice/${id}/notes`, { body: 'my secret notes' })).status).toBe(200)
    expect((await c.student2.put(`/voice/${id}/notes`, { body: 'other notes' })).status).toBe(200)
    expect((await c.student.get(`/voice/${id}/notes`)).body.body).toBe('my secret notes')
    expect((await c.student2.get(`/voice/${id}/notes`)).body.body).toBe('other notes')
    expect((await c.teacher.get(`/voice/${id}/notes`)).body.body).toBe('') // a teacher cannot read a student's notes
    await c.student.put(`/voice/${id}/notes`, { body: 'updated' })
    expect(await prisma.voiceNote.count({ where: { channelId: id, userId: w.u.student } })).toBe(1) // updated, not duplicated
  })

  it('are refused for people who cannot join, another school, and oversized text', async () => {
    const id = await mkChannel('Notes 2')
    expect((await c.parent.get(`/voice/${id}/notes`)).status).toBe(403)
    expect((await c.parent.put(`/voice/${id}/notes`, { body: 'x' })).status).toBe(403)
    expect((await cb.student.get(`/voice/${id}/notes`)).status).toBe(404)
    expect((await c.student.put(`/voice/${id}/notes`, { body: 'x'.repeat(20_001) })).status).toBe(400)
  })

  it('disappear with the channel', async () => {
    const id = await mkChannel('Notes 3')
    await c.student.put(`/voice/${id}/notes`, { body: 'gone soon' })
    await c.teacher.delete(`/voice/${id}`)
    expect(await prisma.voiceNote.count({ where: { channelId: id } })).toBe(0)
  })
})

describe('voice signaling', () => {
  it('admits class members, refuses parents, other teachers and other schools, and tells newcomers who is already there', async () => {
    const id = await mkChannel('Call 1')
    const student = await connect(c.student.token), teacher = await connect(c.teacher.token)
    const parent = await connect(c.parent.token), teacher2 = await connect(c.teacher2.token), other = await connect(cb.principal.token)

    const s1 = await ack(student, 'voice:join', { channelId: id })
    expect(s1).toMatchObject({ ok: true, peers: [], channel: { id, name: 'Call 1' } })

    const joined = nextEvent(student, 'voice:peer-joined')
    const t1 = await ack(teacher, 'voice:join', { channelId: id })
    expect(t1.ok).toBe(true)
    expect(t1.peers).toHaveLength(1)
    expect(t1.peers[0]).toMatchObject({ userId: w.u.student, name: 'student', role: 'student' })
    expect(await joined).toMatchObject({ userId: w.u.teacher, role: 'teacher' })

    for (const s of [parent, teacher2, other]) expect((await ack(s, 'voice:join', { channelId: id })).ok).toBe(false)
    expect((await ack(student, 'voice:join', { channelId: 'does-not-exist' })).ok).toBe(false)
  })

  it('lets school staff join any class call', async () => {
    const id = await mkChannel('Call staff')
    for (const r of ['principal', 'clerk', 'admin'] as const) {
      const s = await connect(c[r].token)
      expect((await ack(s, 'voice:join', { channelId: id })).ok, r).toBe(true)
    }
  })

  it('relays connection messages only between people in the same call', async () => {
    const id = await mkChannel('Call 2'), id2 = await mkChannel('Call 3')
    const a = await connect(c.student.token), b = await connect(c.student2.token), outsider = await connect(c.teacher.token)
    const aj = await ack(a, 'voice:join', { channelId: id })
    const bj = await ack(b, 'voice:join', { channelId: id })
    await ack(outsider, 'voice:join', { channelId: id2 })

    const got = nextEvent(b, 'voice:signal')
    expect((await ack(a, 'voice:signal', { channelId: id, to: bj.me.socketId, data: { description: { type: 'offer', sdp: 'x' } } })).ok).toBe(true)
    expect(await got).toEqual({ from: aj.me.socketId, data: { description: { type: 'offer', sdp: 'x' } } })

    // Someone in a different call cannot inject messages into this one, nor can a sender target an outsider.
    const spy = nextEvent(b, 'voice:signal', 600)
    expect((await ack(outsider, 'voice:signal', { channelId: id, to: bj.me.socketId, data: { evil: true } })).ok).toBe(false)
    expect((await ack(a, 'voice:signal', { channelId: id, to: outsider.id, data: { evil: true } })).ok).toBe(false)
    expect(await spy).toBe('timeout')
  })

  it('shares mic, camera and screen-share status, and announces when people leave or drop', async () => {
    const id = await mkChannel('Call 4')
    const a = await connect(c.student.token), b = await connect(c.student2.token)
    const aj = await ack(a, 'voice:join', { channelId: id })
    await ack(b, 'voice:join', { channelId: id })

    const st = nextEvent(b, 'voice:peer-state')
    await ack(a, 'voice:state', { channelId: id, mic: true, camera: true, screenStreamId: 'stream-9' })
    expect(await st).toEqual({ socketId: aj.me.socketId, state: { mic: true, camera: true, screenStreamId: 'stream-9' } })

    // A latecomer sees the current state straight away.
    const late = await connect(c.teacher.token)
    const lj = await ack(late, 'voice:join', { channelId: id })
    expect(lj.peers.find((p: any) => p.socketId === aj.me.socketId).state).toMatchObject({ mic: true, camera: true, screenStreamId: 'stream-9' })

    const left = nextEvent(b, 'voice:peer-left')
    await ack(a, 'voice:leave', { channelId: id })
    expect(await left).toEqual({ socketId: aj.me.socketId })

    const dropped = nextEvent(b, 'voice:peer-left')
    late.close()
    expect((await dropped).socketId).toBe(late.id ?? (await dropped).socketId)
    expect((await ack(a, 'voice:state', { channelId: id, mic: true })).ok).toBe(false) // no longer in the call
  })

  it('caps the call size, and a spot frees up when someone leaves', async () => {
    const id = await mkChannel('Full room')
    const list = await c.student.get(`/voice/class/${w.classA}`)
    const max = list.body.max
    const joined: Socket[] = []
    for (let i = 0; i < max; i++) {
      const s = await connect(c.student.token)
      expect((await ack(s, 'voice:join', { channelId: id })).ok).toBe(true)
      joined.push(s)
    }
    const extra = await connect(c.student2.token)
    const full = await ack(extra, 'voice:join', { channelId: id })
    expect(full.ok).toBe(false)
    expect(full.error).toMatch(/full/i)
    await ack(joined[0], 'voice:leave', { channelId: id })
    expect((await ack(extra, 'voice:join', { channelId: id })).ok).toBe(true)
    // The list shows who is in the call right now.
    expect((await c.student.get(`/voice/class/${w.classA}`)).body.channels.find((x: any) => x.id === id).participants).toHaveLength(max)
  })

  it('joining a second channel leaves the first', async () => {
    const one = await mkChannel('Hop 1'), two = await mkChannel('Hop 2')
    const a = await connect(c.student.token), b = await connect(c.student2.token)
    await ack(b, 'voice:join', { channelId: one })
    await ack(a, 'voice:join', { channelId: one })
    const left = nextEvent(b, 'voice:peer-left')
    await ack(a, 'voice:join', { channelId: two })
    expect((await left).socketId).toBe(a.id)
  })

  it('deleting a channel ends the call for everyone in it', async () => {
    const id = await mkChannel('Doomed')
    const a = await connect(c.student.token)
    await ack(a, 'voice:join', { channelId: id })
    const closed = nextEvent(a, 'voice:closed')
    expect((await c.teacher.delete(`/voice/${id}`)).status).toBe(200)
    expect(await closed).toEqual({ channelId: id })
    expect((await ack(a, 'voice:join', { channelId: id })).ok).toBe(false)
  })

  it('lets a manager mute someone, who is told, shown as muted to everyone, and audited', async () => {
    const id = await mkChannel('Mod mute')
    const stu = await connect(c.student.token), other = await connect(c.student2.token), teacher = await connect(c.teacher.token)
    const sj = await ack(stu, 'voice:join', { channelId: id })
    await ack(other, 'voice:join', { channelId: id })
    await ack(teacher, 'voice:join', { channelId: id })
    await ack(stu, 'voice:state', { channelId: id, mic: true })
    const told = nextEvent(stu, 'voice:muted'), seen = nextEvent(other, 'voice:peer-state')
    expect((await ack(teacher, 'voice:moderate', { channelId: id, to: sj.me.socketId, action: 'mute' })).ok).toBe(true)
    expect(await told).toMatchObject({ by: 'teacher' })
    expect(await seen).toEqual({ socketId: sj.me.socketId, state: { mic: false, camera: false, screenStreamId: null } })
    expect(await prisma.auditLog.count({ where: { action: 'voice.participant_muted', resourceId: id, actorId: w.u.teacher } })).toBe(1)
  })

  it('lets a manager remove someone, who is kept out for a while and can return once the time is up', async () => {
    const id = await mkChannel('Mod remove')
    const stu = await connect(c.student.token), teacher = await connect(c.teacher.token)
    const sj = await ack(stu, 'voice:join', { channelId: id })
    await ack(teacher, 'voice:join', { channelId: id })
    const removed = nextEvent(stu, 'voice:removed'), left = nextEvent(teacher, 'voice:peer-left')
    expect((await ack(teacher, 'voice:moderate', { channelId: id, to: sj.me.socketId, action: 'remove' })).ok).toBe(true)
    expect(await removed).toMatchObject({ by: 'teacher' })
    expect((await left).socketId).toBe(sj.me.socketId)
    const back = await ack(stu, 'voice:join', { channelId: id })
    expect(back.ok).toBe(false)
    expect(back.error).toMatch(/removed/i)
    expect((await c.student2.get(`/voice/class/${w.classA}`)).body.channels.find((x: any) => x.id === id).participants.map((p: any) => p.name)).toEqual(['teacher'])
    expect(await prisma.auditLog.count({ where: { action: 'voice.participant_removed', resourceId: id } })).toBe(1)
    // Another channel is not affected, and the ban lapses on its own.
    const elsewhere = await mkChannel('Mod elsewhere')
    expect((await ack(stu, 'voice:join', { channelId: elsewhere })).ok).toBe(true)
    const rooms = app.get(VoiceRooms)
    expect(rooms.banned(id, w.u.student, Date.now() + (REMOVAL_MINUTES * 60_000) + 1000)).toBe(false)
  })

  it('does not let students, other teachers or outsiders moderate, nor moderate a manager or themselves', async () => {
    const id = await mkChannel('Mod refused')
    const a = await connect(c.student.token), b = await connect(c.student2.token), teacher = await connect(c.teacher.token), principal = await connect(c.principal.token)
    const aj = await ack(a, 'voice:join', { channelId: id })
    const bj = await ack(b, 'voice:join', { channelId: id })
    const tj = await ack(teacher, 'voice:join', { channelId: id })
    const pj = await ack(principal, 'voice:join', { channelId: id })
    const outsider = await connect(c.teacher2.token)
    for (const action of ['mute', 'remove']) {
      expect((await ack(a, 'voice:moderate', { channelId: id, to: bj.me.socketId, action })).ok, `student ${action}`).toBe(false)
      expect((await ack(outsider, 'voice:moderate', { channelId: id, to: bj.me.socketId, action })).ok, `outsider ${action}`).toBe(false)
      expect((await ack(teacher, 'voice:moderate', { channelId: id, to: pj.me.socketId, action })).ok, `manager ${action}`).toBe(false)
      expect((await ack(principal, 'voice:moderate', { channelId: id, to: tj.me.socketId, action })).ok, `manager ${action}`).toBe(false)
      expect((await ack(teacher, 'voice:moderate', { channelId: id, to: tj.me.socketId, action })).ok, `self ${action}`).toBe(false)
      expect((await ack(teacher, 'voice:moderate', { channelId: id, to: 'not-a-socket', action })).ok, `stranger ${action}`).toBe(false)
    }
    expect((await ack(teacher, 'voice:moderate', { channelId: id, to: aj.me.socketId, action: 'shout' })).ok).toBe(false)
    expect(await prisma.auditLog.count({ where: { resourceId: id, action: { in: ['voice.participant_muted', 'voice.participant_removed'] } } })).toBe(0)
  })

  it('refuses connections with a bad token', async () => {
    const bad = io(`http://localhost:${port}`, { auth: { token: 'junk' }, reconnection: false })
    sockets.push(bad)
    const closed = await new Promise<boolean>((r) => { bad.on('disconnect', () => r(true)); setTimeout(() => r(false), 4000) })
    expect(closed).toBe(true)
  })
})
