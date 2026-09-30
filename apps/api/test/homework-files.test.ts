import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>
let assignmentId: string

const PDF = Buffer.from('%PDF-1.4\nhello')
const send = (who: Client, id: string, data: Buffer, name: string) =>
  request(app.getHttpServer()).post(`/api/homework/${id}/files`).set('authorization', `Bearer ${who.token}`).attach('file', data, name)
const download = (who: Client, fileId: string) =>
  request(app.getHttpServer()).get(`/api/homework/files/${fileId}`).set('authorization', `Bearer ${who.token}`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))) })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
  const a = await c.teacher.post('/homework', { classIds: [w.classA], title: 'Essay', description: 'Write', dueDate: daysFromNow(3) })
  assignmentId = (await prisma.assignment.findFirstOrThrow({ where: { classId: w.classA } })).id
  expect(a.status).toBe(201)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('homework files: uploading', () => {
  it('the class teacher attaches a file and students, parents and the teacher can download it byte for byte', async () => {
    const up = await send(c.teacher, assignmentId, PDF, 'worksheet.pdf')
    expect(up.status).toBe(201)
    expect(up.body.name).toBe('worksheet.pdf')
    for (const r of ['student', 'parent', 'teacher', 'principal'] as const) {
      const res = await download(c[r], up.body.id)
      expect(res.status, r).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.compare(res.body, PDF), r).toBe(0)
    }
    const list = await c.student.get(`/homework?classId=${w.classA}`)
    expect(list.body[0].files.map((f: any) => f.name)).toEqual(['worksheet.pdf'])
    expect(list.body[0].files[0].storageKey).toBeUndefined()
  })

  it('outsiders cannot attach or read', async () => {
    expect((await send(c.teacher2, assignmentId, PDF, 'x.pdf')).status).toBe(403)
    expect((await send(c.parent, assignmentId, PDF, 'x.pdf')).status).toBe(403)
    expect((await send(c.clerk, assignmentId, PDF, 'x.pdf')).status).toBe(403)
    const f = await prisma.homeworkFile.findFirstOrThrow({ where: { studentId: null } })
    expect((await download(c.teacher2, f.id)).status).toBe(403)
  })

  it('rejects missing files, wrong types, and content that does not match its extension', async () => {
    expect((await request(app.getHttpServer()).post(`/api/homework/${assignmentId}/files`).set('authorization', `Bearer ${c.teacher.token}`)).status).toBe(400)
    expect((await send(c.teacher, assignmentId, Buffer.from('MZ\x90'), 'virus.exe')).status).toBe(400)
    expect((await send(c.teacher, assignmentId, Buffer.from('<script>alert(1)</script>'), 'page.pdf')).status).toBe(400)
    expect((await send(c.teacher, assignmentId, Buffer.from('a\u0000b'), 'notes.txt')).status).toBe(400)
  })

  it('rejects files over 10 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024 + 10)])
    // The server may cut the connection as soon as the limit is hit, so a reset counts as a refusal too.
    const status = await send(c.teacher, assignmentId, big, 'big.pdf').then((r) => r.status, () => 413)
    expect(status).toBe(413)
    expect(await prisma.homeworkFile.count({ where: { name: 'big.pdf' } })).toBe(0)
  })

  it('never uses the uploaded name as a path', async () => {
    const res = await send(c.teacher, assignmentId, PDF, '..\..\evil.pdf')
    expect(res.status).toBe(201)
    expect(res.body.name).not.toMatch(/[\/]/)
    const row = await prisma.homeworkFile.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}$/)
    await c.teacher.delete(`/homework/files/${res.body.id}`)
  })

  it('caps files per owner', async () => {
    const have = await prisma.homeworkFile.count({ where: { assignmentId, studentId: null } })
    for (let i = have; i < 5; i++) expect((await send(c.teacher, assignmentId, PDF, `f${i}.pdf`)).status).toBe(201)
    expect((await send(c.teacher, assignmentId, PDF, 'one-too-many.pdf')).status).toBe(400)
  })
})

describe('homework files: student hand-ins', () => {
  it('a student hands in a file, which counts as submitted and is private to them, their parent and staff', async () => {
    const up = await send(c.student, assignmentId, PDF, 'my-essay.pdf')
    expect(up.status).toBe(201)
    expect(await prisma.submission.count({ where: { assignmentId, studentId: w.u.student } })).toBe(1)
    expect((await download(c.student, up.body.id)).status).toBe(200)
    expect((await download(c.parent, up.body.id)).status).toBe(200)
    expect((await download(c.teacher, up.body.id)).status).toBe(200)
    expect((await download(c.principal, up.body.id)).status).toBe(200)
    expect((await download(c.student2, up.body.id)).status).toBe(403)
    expect((await download(c.teacher2, up.body.id)).status).toBe(403)
    const mine = (await c.student.get(`/homework?classId=${w.classA}`)).body[0]
    expect(mine.myFiles.map((f: any) => f.name)).toEqual(['my-essay.pdf'])
    expect(mine.files.map((f: any) => f.name)).not.toContain('my-essay.pdf')
    const subs = (await c.teacher.get(`/homework/${assignmentId}/submissions`)).body
    expect(subs.find((s: any) => s.studentId === w.u.student).files.map((f: any) => f.name)).toEqual(['my-essay.pdf'])
    // Another student does not see it in their own list.
    expect((await c.student2.get(`/homework?classId=${w.classA}`)).body[0].myFiles).toEqual([])
  })
})

describe('homework files: removing', () => {
  it('the uploader or the class teacher can delete; others cannot; the stored file goes too', async () => {
    const mine = await prisma.homeworkFile.findFirstOrThrow({ where: { studentId: w.u.student } })
    expect((await c.student2.delete(`/homework/files/${mine.id}`)).status).toBe(403)
    expect((await c.parent.delete(`/homework/files/${mine.id}`)).status).toBe(403)
    expect((await c.student.delete(`/homework/files/${mine.id}`)).status).toBe(200)
    expect((await download(c.student, mine.id)).status).toBe(404)
    const att = await prisma.homeworkFile.findFirstOrThrow({ where: { studentId: null } })
    expect((await c.student.delete(`/homework/files/${att.id}`)).status).toBe(403)
    expect((await c.teacher.delete(`/homework/files/${att.id}`)).status).toBe(200)
    expect(await prisma.auditLog.count({ where: { action: 'homework.file_deleted' } })).toBe(3)
  })
})
