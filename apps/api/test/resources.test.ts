import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World
let wb: World
let c: Awaited<ReturnType<typeof clients>>

const PDF = Buffer.from('%PDF-1.4\nnotes')
const send = (who: Client, classId: string, data: Buffer, name: string) =>
  request(app.getHttpServer()).post(`/api/resources/class/${classId}`).set('authorization', `Bearer ${who.token}`).attach('file', data, name)
const download = (who: Client, id: string) =>
  request(app.getHttpServer()).get(`/api/resources/files/${id}`).set('authorization', `Bearer ${who.token}`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))) })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  wb = await seedWorld('B')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('resources channel', () => {
  it('only the class teacher uploads', async () => {
    for (const r of ['teacher2', 'student', 'parent', 'clerk', 'principal', 'admin'] as const) expect((await send(c[r], w.classA, PDF, 'x.pdf')).status, r).toBe(403)
    const up = await send(c.teacher, w.classA, PDF, 'syllabus.pdf')
    expect(up.status).toBe(201)
    expect(up.body.name).toBe('syllabus.pdf')
  })

  it('class members, their parents, the teacher and school staff can list and download; others cannot', async () => {
    const f = await prisma.resourceFile.findFirstOrThrow({ where: { classId: w.classA } })
    for (const r of ['student', 'student2', 'parent', 'teacher', 'principal', 'admin', 'clerk'] as const) {
      const list = await c[r].get(`/resources/class/${w.classA}`)
      expect(list.status, r).toBe(200)
      expect(list.body.files.map((x: any) => x.name), r).toEqual(['syllabus.pdf'])
      expect(list.body.files[0].storageKey).toBeUndefined()
      const res = await download(c[r], f.id)
      expect(res.status, r).toBe(200)
      expect(Buffer.compare(res.body, PDF), r).toBe(0)
      expect(res.headers['content-disposition']).toContain('attachment')
    }
    expect((await c.teacher.get(`/resources/class/${w.classA}`)).body.canUpload).toBe(true)
    expect((await c.student.get(`/resources/class/${w.classA}`)).body.canUpload).toBe(false)
    expect((await c.teacher2.get(`/resources/class/${w.classA}`)).status).toBe(403)
    expect((await download(c.teacher2, f.id)).status).toBe(403)
  })

  it('a student not in the class cannot read it', async () => {
    // student and student2 are in Class A; Class B is empty, so they must not read it.
    expect((await c.student.get(`/resources/class/${w.classB}`)).status).toBe(403)
    expect((await c.parent.get(`/resources/class/${w.classB}`)).status).toBe(403)
  })

  it('is closed to other schools', async () => {
    const f = await prisma.resourceFile.findFirstOrThrow({ where: { classId: w.classA } })
    const bClients = await clients(app, 'b')
    expect((await bClients.principal.get(`/resources/class/${w.classA}`)).status).toBe(403)
    expect((await download(bClients.principal, f.id)).status).toBe(404)
    expect((await send(bClients.teacher, w.classA, PDF, 'x.pdf')).status).toBe(403)
    expect(wb.classA).not.toBe(w.classA)
  })

  it('validates the file', async () => {
    expect((await request(app.getHttpServer()).post(`/api/resources/class/${w.classA}`).set('authorization', `Bearer ${c.teacher.token}`)).status).toBe(400)
    expect((await send(c.teacher, w.classA, Buffer.from('MZ'), 'tool.exe')).status).toBe(400)
    expect((await send(c.teacher, w.classA, Buffer.from('<html>'), 'page.pdf')).status).toBe(400)
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024 + 10)])
    expect(await send(c.teacher, w.classA, big, 'big.pdf').then((r) => r.status, () => 413)).toBe(413)
    expect(await prisma.resourceFile.count({ where: { name: 'big.pdf' } })).toBe(0)
  })

  it('only the class teacher deletes, and the file is gone afterwards', async () => {
    const f = await prisma.resourceFile.findFirstOrThrow({ where: { classId: w.classA } })
    for (const r of ['student', 'parent', 'teacher2', 'clerk', 'principal'] as const) expect((await c[r].delete(`/resources/files/${f.id}`)).status, r).toBe(403)
    expect((await c.teacher.delete(`/resources/files/${f.id}`)).status).toBe(200)
    expect((await download(c.student, f.id)).status).toBe(404)
    expect(await prisma.auditLog.count({ where: { action: { in: ['resource.uploaded', 'resource.deleted'] } } })).toBe(2)
  })
})
