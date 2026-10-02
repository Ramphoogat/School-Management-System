import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let wb: World
let c: Awaited<ReturnType<typeof clients>>
let cb: Awaited<ReturnType<typeof clients>>

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  wb = await seedWorld('B')
  c = await clients(app, 'a')
  cb = await clients(app, 'b')
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

type Who = keyof typeof c
/** A class with the demo school's student, student2 and teacher in it (and a books channel), so each test can delete its own. */
async function makeClass(name: string) {
  const cls = await prisma.class.create({ data: { schoolId: w.schoolId, name, classTeacherId: w.u.teacher, channels: { create: ['announcements', 'homework', 'books'].map((t) => ({ type: t, name: t })) } } })
  await prisma.classMember.createMany({
    data: [
      { classId: cls.id, userId: w.u.student, roleInClass: 'student' },
      { classId: cls.id, userId: w.u.student2, roleInClass: 'student' },
      { classId: cls.id, userId: w.u.teacher, roleInClass: 'teacher' },
    ],
  })
  return cls.id
}
const sees = async (who: Who, id: string) => (await c[who].get('/classes')).body.some((x: any) => x.id === id)
/** The books channel is a convenient class-scoped endpoint: a member can open it, a non-member cannot. */
const booksStatus = async (who: Who, id: string) => (await c[who].get(`/books/class/${id}`)).status

describe('who can delete and restore a class', () => {
  it('only the principal and admin; everyone else is refused', async () => {
    const id = await makeClass('Grade 1-A')
    for (const r of ['teacher', 'teacher2', 'clerk', 'student', 'parent'] as const) {
      expect((await c[r].delete(`/classes/${id}`)).status, `${r} delete`).toBe(403)
      expect((await c[r].get('/classes/deleted')).status, `${r} list`).toBe(403)
      expect((await c[r].post(`/classes/${id}/restore`)).status, `${r} restore`).toBe(403)
    }
    expect((await prisma.class.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull()

    const del = await c.principal.delete(`/classes/${id}`)
    expect(del.status).toBe(200)
    expect(del.body).toMatchObject({ ok: true, id, name: 'Grade 1-A' })

    const id2 = await makeClass('Grade 1-B')
    expect((await c.admin.delete(`/classes/${id2}`)).status).toBe(200)
    expect((await c.admin.post(`/classes/${id2}/restore`)).status).toBe(201)
  })

  it('does not touch another school\'s classes', async () => {
    const id = await makeClass('Grade 2-A')
    expect((await cb.principal.delete(`/classes/${id}`)).status).toBe(404)
    expect((await cb.admin.post(`/classes/${id}/restore`)).status).toBe(404)
    expect((await prisma.class.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull()
    expect((await cb.principal.get('/classes/deleted')).body).toEqual([])
    expect(wb.schoolId).not.toBe(w.schoolId)
  })
})

describe('deleting', () => {
  it('hides the class from every list, but erases nothing', async () => {
    const id = await makeClass('Grade 3-A')
    for (const r of ['principal', 'admin', 'clerk', 'teacher', 'student', 'student2', 'parent'] as const) expect(await sees(r, id), `${r} before`).toBe(true)

    expect((await c.principal.delete(`/classes/${id}`)).status).toBe(200)
    for (const r of ['principal', 'admin', 'clerk', 'teacher', 'student', 'student2', 'parent'] as const) expect(await sees(r, id), `${r} after`).toBe(false)

    const row = await prisma.class.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(row.deletedById).toBe(w.u.principal)
    expect(await prisma.classMember.count({ where: { classId: id } })).toBe(3) // members stay
    expect(await prisma.channel.count({ where: { classId: id } })).toBe(3) // so do channels
  })

  it('takes away the class from its students and teacher at once', async () => {
    const id = await makeClass('Grade 3-B')
    expect(await booksStatus('student', id)).toBe(200)
    expect(await booksStatus('teacher', id)).toBe(200)
    await c.admin.delete(`/classes/${id}`)
    expect(await booksStatus('student', id)).toBe(403)
    expect(await booksStatus('student2', id)).toBe(403)
    expect(await booksStatus('teacher', id)).toBe(403)
  })

  it('cannot be done twice, and is recorded', async () => {
    const id = await makeClass('Grade 3-C')
    expect((await c.principal.delete(`/classes/${id}`)).status).toBe(200)
    expect((await c.principal.delete(`/classes/${id}`)).status).toBe(404) // already gone from view
    const log = await prisma.auditLog.findMany({ where: { action: 'class.deleted', resourceId: id } })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ actorId: w.u.principal })
    expect(log[0].meta).toEqual({ name: 'Grade 3-C', members: 3 })
  })

  it('stops new homework being given to a deleted class', async () => {
    const id = await makeClass('Grade 3-D')
    await c.principal.delete(`/classes/${id}`)
    const r = await c.teacher.post('/homework', { classIds: [id], title: 'Too late', description: '', dueDate: '2099-01-01', channels: ['in_app'] })
    expect(r.status).toBe(403)
    expect(await prisma.assignment.count({ where: { classId: id } })).toBe(0)
  })
})

describe('the deleted classes list', () => {
  it('shows the principal and admin what was deleted, by whom and with how many members, newest first', async () => {
    const first = await makeClass('Grade 4-A'), second = await makeClass('Grade 4-B')
    await c.principal.delete(`/classes/${first}`)
    await c.admin.delete(`/classes/${second}`)
    for (const who of ['principal', 'admin'] as const) {
      const list = (await c[who].get('/classes/deleted')).body
      const ids = list.map((x: any) => x.id)
      expect(ids.indexOf(second), who).toBeLessThan(ids.indexOf(first)) // the most recent first
      expect(list.find((x: any) => x.id === first)).toMatchObject({ name: 'Grade 4-A', members: 3, deletedByName: 'principal' })
      expect(list.find((x: any) => x.id === second)).toMatchObject({ name: 'Grade 4-B', deletedByName: 'admin' })
      expect(typeof list[0].deletedAt).toBe('string')
    }
  })

  it('only holds deleted classes, and never another school\'s', async () => {
    const live = await makeClass('Grade 4-C')
    const mine = (await c.principal.get('/classes/deleted')).body
    expect(mine.some((x: any) => x.id === live)).toBe(false)
    expect(mine.every((x: any) => !!x.deletedAt)).toBe(true)
    const other = await prisma.class.create({ data: { schoolId: wb.schoolId, name: 'Other school class', deletedAt: new Date(), deletedById: wb.u.principal } })
    expect(mine.some((x: any) => x.id === other.id)).toBe(false)
    expect((await cb.principal.get('/classes/deleted')).body.map((x: any) => x.id)).toEqual([other.id])
  })
})

describe('restoring', () => {
  it('brings the class back exactly as it was, for everyone who was in it', async () => {
    const id = await makeClass('Grade 5-A')
    await c.principal.delete(`/classes/${id}`)
    const r = await c.admin.post(`/classes/${id}/restore`) // the admin can restore what the principal deleted
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ ok: true, id, name: 'Grade 5-A' })
    for (const who of ['principal', 'admin', 'clerk', 'teacher', 'student', 'student2', 'parent'] as const) expect(await sees(who, id), who).toBe(true)
    expect(await booksStatus('student', id)).toBe(200)
    expect(await booksStatus('teacher', id)).toBe(200)
    const row = await prisma.class.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).toBeNull()
    expect(row.deletedById).toBeNull()
    expect(row.classTeacherId).toBe(w.u.teacher)
    expect(await prisma.classMember.count({ where: { classId: id } })).toBe(3)
    expect((await c.principal.get('/classes/deleted')).body.some((x: any) => x.id === id)).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: 'class.restored', resourceId: id, actorId: w.u.admin } })).toBe(1)
  })

  it('refuses to restore a class that is not deleted, or does not exist', async () => {
    const id = await makeClass('Grade 5-B')
    const r = await c.principal.post(`/classes/${id}/restore`)
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/not deleted/i)
    expect((await c.principal.post('/classes/does-not-exist/restore')).status).toBe(404)
  })

  it('can be deleted and restored again and again', async () => {
    const id = await makeClass('Grade 5-C')
    for (let i = 0; i < 3; i++) {
      expect((await c.principal.delete(`/classes/${id}`)).status, `delete ${i}`).toBe(200)
      expect((await c.principal.post(`/classes/${id}/restore`)).status, `restore ${i}`).toBe(201)
    }
    expect(await sees('student', id)).toBe(true)
  })
})

describe('a deleted class keeps its name', () => {
  it('so a new class cannot take it, and the message says where to restore it from', async () => {
    const id = await makeClass('Grade 6-A')
    await c.principal.delete(`/classes/${id}`)
    for (const name of ['Grade 6-A', 'grade 6-a', '  Grade 6-A  ']) {
      const r = await c.principal.post('/classes', { name })
      expect(r.status, name).toBe(400)
      expect(r.body.message, name).toMatch(/was deleted.*Restore it/)
    }
    await c.principal.post(`/classes/${id}/restore`)
    const again = await c.principal.post('/classes', { name: 'Grade 6-A' })
    expect(again.status).toBe(400)
    expect(again.body.message).toMatch(/already exists/)
  })

  it('still lets a new class with a different name be created, and rejects a blank name', async () => {
    const r = await c.principal.post('/classes', { name: 'Grade 6-Z' })
    expect(r.status).toBe(201)
    expect(r.body.name).toBe('Grade 6-Z')
    expect((await c.principal.post('/classes', { name: '   ' })).status).toBe(400)
  })
})
