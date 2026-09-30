import { INestApplication } from '@nestjs/common'
import { createServer, type Server } from 'node:net'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type Client } from './helpers'

let app: INestApplication
let c: Awaited<ReturnType<typeof clients>>

const PDF = Buffer.from('%PDF-1.4\nform')
const send = (who: Client, data: Buffer, name: string, title?: string) => {
  const r = request(app.getHttpServer()).post('/api/documents').set('authorization', `Bearer ${who.token}`)
  if (title) r.field('title', title)
  return r.attach('file', data, name)
}
const download = (who: Client, id: string) =>
  request(app.getHttpServer()).get(`/api/documents/${id}/file`).set('authorization', `Bearer ${who.token}`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))) })

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  await seedWorld('A')
  await seedWorld('B')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('school documents', () => {
  it('clerk, principal and admin publish; nobody else', async () => {
    for (const r of ['teacher', 'student', 'parent'] as const) expect((await send(c[r], PDF, 'x.pdf')).status, r).toBe(403)
    const up = await send(c.clerk, PDF, 'admission-form.pdf', 'Admission form 2026')
    expect(up.status).toBe(201)
    expect(up.body.title).toBe('Admission form 2026')
    expect((await send(c.principal, PDF, 'holiday-list.pdf')).body.title).toBe('holiday-list') // title defaults to the file name
    expect((await send(c.admin, PDF, 'policy.pdf')).status).toBe(201)
  })

  it('everyone in the school can list and download, byte for byte', async () => {
    const f = await prisma.schoolDocument.findFirstOrThrow({ where: { title: 'Admission form 2026' } })
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin'] as const) {
      const list = await c[r].get('/documents')
      expect(list.status, r).toBe(200)
      expect(list.body.files).toHaveLength(3)
      expect(list.body.files[0].storageKey).toBeUndefined()
      const res = await download(c[r], f.id)
      expect(res.status, r).toBe(200)
      expect(Buffer.compare(res.body, PDF), r).toBe(0)
      expect(res.headers['content-disposition']).toContain('attachment')
    }
    expect((await c.clerk.get('/documents')).body.canUpload).toBe(true)
    expect((await c.student.get('/documents')).body.canUpload).toBe(false)
  })

  it('is closed to other schools', async () => {
    const f = await prisma.schoolDocument.findFirstOrThrow({})
    const b = await clients(app, 'b')
    expect((await b.student.get('/documents')).body.files).toEqual([])
    expect((await download(b.student, f.id)).status).toBe(404)
    expect((await b.principal.delete(`/documents/${f.id}`)).status).toBe(404)
  })

  it('validates files and only publishers delete', async () => {
    expect((await send(c.clerk, Buffer.from('MZ'), 'tool.exe')).status).toBe(400)
    expect((await send(c.clerk, Buffer.from('<html>'), 'form.pdf')).status).toBe(400)
    const f = await prisma.schoolDocument.findFirstOrThrow({ where: { title: 'policy' } })
    for (const r of ['teacher', 'student', 'parent'] as const) expect((await c[r].delete(`/documents/${f.id}`)).status, r).toBe(403)
    expect((await c.clerk.delete(`/documents/${f.id}`)).status).toBe(200)
    expect((await download(c.student, f.id)).status).toBe(404)
    expect(await prisma.auditLog.count({ where: { action: { in: ['document.uploaded', 'document.deleted'] } } })).toBe(4)
  })
})

describe('virus scanning (ClamAV)', () => {
  let clam: Server
  let verdict = 'stream: OK'
  let received = 0
  let up = true

  beforeAll(async () => {
    clam = createServer((sock) => {
      const seen: Buffer[] = []
      sock.on('data', (d) => {
        seen.push(d)
        const all = Buffer.concat(seen)
        // The stream ends with a zero-length chunk (four zero bytes) after the command and data.
        if (all.subarray(all.length - 4).equals(Buffer.alloc(4)) && all.toString('latin1').startsWith('zINSTREAM\0')) {
          received = all.length
          sock.end(`${verdict}\0`)
        }
      })
    })
    await new Promise<void>((r) => clam.listen(0, '127.0.0.1', r))
    process.env.CLAMAV_HOST = '127.0.0.1'
    process.env.CLAMAV_PORT = String((clam.address() as { port: number }).port)
  })
  afterAll(async () => {
    delete process.env.CLAMAV_HOST
    delete process.env.CLAMAV_PORT
    await new Promise((r) => clam.close(r))
  })

  it('stores a file the scanner calls clean, and really streams its bytes to the scanner', async () => {
    verdict = 'stream: OK'
    expect((await send(c.clerk, PDF, 'clean.pdf')).status).toBe(201)
    expect(received).toBeGreaterThan(PDF.length)
  })

  it('blocks an infected file and stores nothing', async () => {
    verdict = 'stream: Eicar-Test-Signature FOUND'
    const before = await prisma.schoolDocument.count()
    const res = await send(c.clerk, PDF, 'bad.pdf')
    expect(res.status).toBe(422)
    expect(res.body.message).toMatch(/virus/i)
    expect(await prisma.schoolDocument.count()).toBe(before)
  })

  it('applies to every upload route, not just documents', async () => {
    verdict = 'stream: Eicar-Test-Signature FOUND'
    const cls = (await prisma.class.findFirstOrThrow({ where: { name: 'Grade 8-A', school: { name: 'School A' } } })).id
    const res = await request(app.getHttpServer()).post(`/api/resources/class/${cls}`).set('authorization', `Bearer ${c.teacher.token}`).attach('file', PDF, 'notes.pdf')
    expect(res.status).toBe(422)
    expect(await prisma.resourceFile.count()).toBe(0)
  })

  it('refuses the upload when the scanner cannot be reached, instead of letting it through', async () => {
    const port = process.env.CLAMAV_PORT
    process.env.CLAMAV_PORT = '1' // nothing listens here
    const res = await send(c.clerk, PDF, 'unchecked.pdf')
    process.env.CLAMAV_PORT = port
    expect(up).toBe(true)
    expect(res.status).toBe(503)
    expect(await prisma.schoolDocument.count({ where: { name: 'unchecked.pdf' } })).toBe(0)
  })

  it('treats an unexpected scanner reply as a failure', async () => {
    verdict = 'stream: something odd ERROR'
    expect((await send(c.clerk, PDF, 'odd.pdf')).status).toBe(503)
  })
})

describe('without a scanner configured', () => {
  it('uploads work as before', async () => {
    expect(process.env.CLAMAV_HOST).toBeUndefined()
    expect((await send(c.clerk, PDF, 'plain.pdf')).status).toBe(201)
  })
})
