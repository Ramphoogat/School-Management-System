import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World
let wb: World
let c: Awaited<ReturnType<typeof clients>>
let cb: Awaited<ReturnType<typeof clients>>

const PDF = Buffer.from('%PDF-1.4\nthe maths book')
const add = (who: Client, classId: string, fields: Record<string, string>, data: Buffer | null = PDF, name = 'maths.pdf') => {
  let r = request(app.getHttpServer()).post(`/api/books/class/${classId}`).set('authorization', `Bearer ${who.token}`)
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v) // text fields first, then the file
  return data ? r.attach('file', data, name) : r
}
const download = (who: Client, id: string) =>
  request(app.getHttpServer()).get(`/api/books/files/${id}`).set('authorization', `Bearer ${who.token}`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))) })
const bookOf = (title: string) => prisma.book.findFirstOrThrow({ where: { title } })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  wb = await seedWorld('B')
  c = await clients(app, 'a')
  cb = await clients(app, 'b')
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('a new class gets a books channel', () => {
  it('creates one among the standard channels', async () => {
    const r = await c.principal.post('/classes', { name: 'Grade 10-C' })
    expect(r.status).toBe(201)
    const channels = await prisma.channel.findMany({ where: { classId: r.body.id } })
    expect(channels.map((x) => x.type)).toContain('books')
  })
})

describe('who can add books', () => {
  it('the class teacher, clerk, principal and admin can; students, parents and other classes\' teachers cannot', async () => {
    for (const r of ['student', 'parent', 'teacher2'] as const) expect((await add(c[r], w.classA, { title: 'Nope' })).status, r).toBe(403)
    const made: Record<string, number> = {}
    for (const r of ['teacher', 'clerk', 'principal', 'admin'] as const) made[r] = (await add(c[r], w.classA, { title: `Book by ${r}`, author: 'A. Writer', description: 'Chapter 1 to 5' })).status
    expect(made).toEqual({ teacher: 201, clerk: 201, principal: 201, admin: 201 })
  })

  it('an admin or clerk can add to any class, a teacher only to their own', async () => {
    expect((await add(c.clerk, w.classB, { title: 'Clerk book for B' })).status).toBe(201)
    expect((await add(c.teacher, w.classB, { title: 'Wrong class' })).status).toBe(403)
    expect((await add(cb.admin, w.classA, { title: 'Other school' }, PDF)).status).toBe(403) // another school's class is not theirs
  })

  it('needs a title and a real file of an allowed type', async () => {
    expect((await add(c.teacher, w.classA, { title: '   ' })).status).toBe(400)
    expect((await add(c.teacher, w.classA, {})).status).toBe(400)
    expect((await add(c.teacher, w.classA, { title: 'No file' }, null)).status).toBe(400)
    expect((await add(c.teacher, w.classA, { title: 'Disguised' }, Buffer.from('MZ not a pdf at all'), 'book.pdf')).status).toBe(400)
    expect((await add(c.teacher, w.classA, { title: 'x'.repeat(121) })).status).toBe(400)
    expect((await add(c.teacher, w.classA, { title: 'ok', description: 'y'.repeat(601) })).status).toBe(400)
  })

  it('is recorded in the audit log', async () => {
    const b = await bookOf('Book by teacher')
    expect(await prisma.auditLog.count({ where: { action: 'book.added', resourceId: b.id, actorId: w.u.teacher } })).toBe(1)
  })
})

describe('who can see and read books', () => {
  it('the class students and the staff see the list; parents, other classes and other schools do not', async () => {
    for (const r of ['student', 'student2', 'teacher', 'clerk', 'principal', 'admin'] as const) {
      const list = await c[r].get(`/books/class/${w.classA}`)
      expect(list.status, r).toBe(200)
      expect(list.body.books.map((b: any) => b.title).sort(), r).toEqual(['Book by admin', 'Book by clerk', 'Book by principal', 'Book by teacher'])
      expect(list.body.books[0].storageKey, r).toBeUndefined()
    }
    expect((await c.parent.get(`/books/class/${w.classA}`)).status).toBe(403)
    expect((await c.teacher2.get(`/books/class/${w.classA}`)).status).toBe(403)
    expect((await cb.student.get(`/books/class/${w.classA}`)).status).toBe(403)
  })

  it('tells each person what they can do', async () => {
    const as = async (r: keyof typeof c) => (await c[r].get(`/books/class/${w.classA}`)).body
    expect(await as('student')).toMatchObject({ canAdd: false, canRevoke: false })
    expect(await as('teacher')).toMatchObject({ canAdd: true, canRevoke: false })
    expect(await as('clerk')).toMatchObject({ canAdd: true, canRevoke: false })
    expect(await as('principal')).toMatchObject({ canAdd: true, canRevoke: true })
    expect(await as('admin')).toMatchObject({ canAdd: true, canRevoke: true })
  })

  it('downloads the file for those people and refuses the rest', async () => {
    const b = await bookOf('Book by teacher')
    for (const r of ['student', 'student2', 'teacher', 'clerk', 'principal', 'admin'] as const) {
      const res = await download(c[r], b.id)
      expect(res.status, r).toBe(200)
      expect(Buffer.compare(res.body, PDF), r).toBe(0)
      expect(res.headers['content-disposition'], r).toContain('attachment')
    }
    for (const r of ['parent', 'teacher2'] as const) expect((await download(c[r], b.id)).status, r).toBe(403)
    expect((await download(cb.student, b.id)).status).toBe(404) // another school cannot even tell it exists
  })
})

describe('withdrawing a book from one student', () => {
  it('only the principal and admin can see the access list, withdraw or give back', async () => {
    const b = await bookOf('Book by clerk')
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'teacher2'] as const) {
      expect((await c[r].get(`/books/${b.id}/access`)).status, `${r} list`).toBe(403)
      expect((await c[r].post(`/books/${b.id}/revoke`, { studentId: w.u.student })).status, `${r} revoke`).toBe(403)
      expect((await c[r].post(`/books/${b.id}/restore`, { studentId: w.u.student })).status, `${r} restore`).toBe(403)
    }
    const list = await c.principal.get(`/books/${b.id}/access`)
    expect(list.status).toBe(200)
    expect(list.body.students.map((s: any) => [s.name, s.revoked])).toEqual([['student', false], ['student2', false]])
  })

  it('withdraws it from one student only: they still see it, cannot open it, and the other student is unaffected', async () => {
    const b = await bookOf('Book by clerk')
    const r = await c.principal.post(`/books/${b.id}/revoke`, { studentId: w.u.student, reason: 'Lost the printed copy' })
    expect(r.status).toBe(201)

    const mine = (await c.student.get(`/books/class/${w.classA}`)).body.books.find((x: any) => x.id === b.id)
    expect(mine).toMatchObject({ title: 'Book by clerk', revoked: true })
    const blocked = await download(c.student, b.id)
    expect(blocked.status).toBe(403)

    const other = (await c.student2.get(`/books/class/${w.classA}`)).body.books.find((x: any) => x.id === b.id)
    expect(other.revoked).toBe(false)
    expect((await download(c.student2, b.id)).status).toBe(200)
    expect((await download(c.teacher, b.id)).status).toBe(200) // staff are not affected

    const access = (await c.admin.get(`/books/${b.id}/access`)).body.students
    expect(access.find((s: any) => s.name === 'student')).toMatchObject({ revoked: true, reason: 'Lost the printed copy' })
    expect((await c.principal.get(`/books/class/${w.classA}`)).body.books.find((x: any) => x.id === b.id).revokedCount).toBe(1)
    expect((await c.student.get(`/books/class/${w.classA}`)).body.books[0].revokedCount).toBeUndefined() // students are not told how many
    expect(await prisma.auditLog.count({ where: { action: 'book.access_revoked', resourceId: b.id, actorId: w.u.principal } })).toBe(1)
  })

  it('withdrawing the same book again just updates the reason', async () => {
    const b = await bookOf('Book by clerk')
    expect((await c.admin.post(`/books/${b.id}/revoke`, { studentId: w.u.student, reason: 'Second note' })).status).toBe(201)
    expect(await prisma.bookRevocation.count({ where: { bookId: b.id, studentId: w.u.student } })).toBe(1)
    expect((await prisma.bookRevocation.findFirstOrThrow({ where: { bookId: b.id } })).reason).toBe('Second note')
  })

  it('only works for students of that class', async () => {
    const b = await bookOf('Book by clerk')
    expect((await c.principal.post(`/books/${b.id}/revoke`, { studentId: w.u.parent })).status).toBe(400)
    expect((await c.principal.post(`/books/${b.id}/revoke`, { studentId: w.u.teacher })).status).toBe(400)
    expect((await c.principal.post(`/books/${b.id}/revoke`, { studentId: 'nobody' })).status).toBe(400)
    expect((await cb.principal.post(`/books/${b.id}/revoke`, { studentId: w.u.student })).status).toBe(404)
    expect((await cb.principal.get(`/books/${b.id}/access`)).status).toBe(404)
  })

  it('gives the book back, and records it', async () => {
    const b = await bookOf('Book by clerk')
    expect((await c.principal.post(`/books/${b.id}/restore`, { studentId: w.u.student })).status).toBe(201)
    expect((await download(c.student, b.id)).status).toBe(200)
    expect((await c.student.get(`/books/class/${w.classA}`)).body.books.find((x: any) => x.id === b.id).revoked).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: 'book.access_restored', resourceId: b.id } })).toBe(1)
    expect((await c.principal.post(`/books/${b.id}/restore`, { studentId: w.u.student })).status).toBe(201) // giving back twice is harmless
    expect(await prisma.auditLog.count({ where: { action: 'book.access_restored', resourceId: b.id } })).toBe(1)
  })
})

describe('removing books', () => {
  it('lets the people who can add also remove, deletes the stored file and the withdrawals, and audits it', async () => {
    const mk = async (title: string) => (await add(c.teacher, w.classA, { title })).body.id as string
    const id = await mk('To remove')
    await c.principal.post(`/books/${id}/revoke`, { studentId: w.u.student2 })
    for (const r of ['student', 'parent', 'teacher2'] as const) expect((await c[r].delete(`/books/${id}`)).status, r).toBe(403)
    expect((await cb.admin.delete(`/books/${id}`)).status).toBe(404)
    expect((await c.teacher.delete(`/books/${id}`)).status).toBe(200)
    expect(await prisma.book.count({ where: { id } })).toBe(0)
    expect(await prisma.bookRevocation.count({ where: { bookId: id } })).toBe(0)
    expect((await download(c.teacher, id)).status).toBe(404)
    expect(await prisma.auditLog.count({ where: { action: 'book.removed', resourceId: id } })).toBe(1)

    const id2 = await mk('To remove by clerk')
    expect((await c.clerk.delete(`/books/${id2}`)).status).toBe(200)
  })
})

describe('limits and isolation', () => {
  it('stops at 100 books in one class', async () => {
    const have = await prisma.book.count({ where: { classId: w.classB } })
    await prisma.book.createMany({
      data: Array.from({ length: 100 - have }, (_, i) => ({ schoolId: w.schoolId, classId: w.classB, title: `Filler ${i}`, name: 'f.pdf', mime: 'application/pdf', size: 1, storageKey: `filler-${i}`, addedById: w.u.clerk })),
    })
    const r = await add(c.clerk, w.classB, { title: 'One too many' })
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/100 books/)
  })

  it('does not mix schools up', async () => {
    await add(cb.teacher, wb.classA, { title: 'School B book' })
    const mine = (await c.admin.get(`/books/class/${w.classA}`)).body.books.map((b: any) => b.title)
    expect(mine).not.toContain('School B book')
    expect((await c.admin.get(`/books/class/${wb.classA}`)).status).toBe(403)
  })
})
