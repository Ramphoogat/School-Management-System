import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld } from './helpers'

let app: INestApplication
let c: Awaited<ReturnType<typeof clients>>
let google: Server
let base: string
let fileId = ''
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest-of-image')])
const stored = new Map<string, Buffer>()

beforeAll(async () => {
  await resetDb()
  await seedWorld('A')
  google = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', base)
      const json = (o: unknown) => res.setHeader('content-type', 'application/json').end(JSON.stringify(o))
      if (url.pathname === '/token') {
        const form = new URLSearchParams(Buffer.concat(chunks).toString())
        return json(form.get('grant_type') === 'authorization_code' ? { refresh_token: 'REFRESH-1', access_token: 'A', expires_in: 3600 } : { access_token: 'A', expires_in: 3600 })
      }
      if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'school@gmail.test' }, storageQuota: { limit: '16106127360', usage: '1073741824' } })
      if (url.pathname === '/drive/v3/files' && req.method === 'POST') return json({ id: 'FOLDER-1' })
      if (url.pathname === '/upload/drive/v3/files') return res.setHeader('location', `${base}/put/1`).end()
      if (url.pathname === '/put/1') { stored.set('D1', Buffer.concat(chunks)); return json({ id: 'D1' }) }
      if (url.pathname === '/drive/v3/files/D1' && req.method === 'GET') return res.setHeader('content-length', String(stored.get('D1')!.length)).end(stored.get('D1'))
      if (url.pathname === '/drive/v3/files/D1' && req.method === 'DELETE') { stored.delete('D1'); return res.statusCode = 204, res.end() }
      res.statusCode = 404; res.end()
    })
  })
  await new Promise<void>((r) => google.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', GDRIVE_TOKEN_URL: `${base}/token`, GDRIVE_API_BASE: base, GDRIVE_AUTH_URL: `${base}/auth`, GDRIVE_FOLDER_ID: '', S3_BUCKET: '' })
  app = await createApp()
  c = await clients(app, 'a')
})
afterAll(async () => { await app.close(); google.close(); await prisma.$disconnect() })

describe('connecting Google Drive', () => {
  it('only staff who manage storage can start the connection, and it goes to Google', async () => {
    expect((await c.teacher.post('/storage/drive/connect')).status).toBe(403)
    expect((await c.student.post('/storage/drive/connect')).status).toBe(403)
    const r = await c.principal.post('/storage/drive/connect')
    expect(r.status).toBe(201)
    expect(r.body.url).toMatch(/\/auth\?/)
    expect(r.body.url).toContain('client_id=cid')
    expect(r.body.url).toContain('drive.file')
  })

  it('finishing the sign-in links the school and shows the space used', async () => {
    const url = new URL((await c.admin.post('/storage/drive/connect')).body.url)
    const back = await request(app.getHttpServer()).get(`/api/storage/drive/callback?code=abc&state=${url.searchParams.get('state')}`)
    expect(back.status).toBe(302)
    expect(back.headers.location).toContain('drive=connected')
    const st = (await c.admin.get('/storage')).body.drive
    expect(st).toMatchObject({ configured: true, source: 'connected', account: 'school@gmail.test', quotaUsedBytes: 1073741824, quotaLimitBytes: 16106127360 })
    // the lasting token is never stored as plain text
    const row = await prisma.driveConnection.findFirstOrThrow()
    expect(row.refreshToken).not.toContain('REFRESH-1')
  })

  it('a bad or forged return from Google links nothing', async () => {
    const r = await request(app.getHttpServer()).get('/api/storage/drive/callback?code=abc&state=forged')
    expect(r.headers.location).toContain('drive=error')
    expect((await request(app.getHttpServer()).get('/api/storage/drive/callback?error=access_denied')).headers.location).toContain('drive=denied')
  })
})

describe('Drive files', () => {
  it('students and parents cannot see or use it; every other role can', async () => {
    for (const who of ['student', 'parent'] as const) {
      expect((await c[who].get('/drive/files')).status).toBe(403)
      expect((await c[who].post('/drive/files')).status).toBe(403)
    }
    for (const who of ['teacher', 'clerk', 'principal', 'admin'] as const) expect((await c[who].get('/drive/files')).body.connected).toBe(true)
  })

  it('staff upload a photo, any staff member can open it, students cannot', async () => {
    const up = await request(app.getHttpServer()).post('/api/drive/files').set('authorization', `Bearer ${c.teacher.token}`).attach('file', PNG, 'photo.png')
    expect(up.status).toBe(201)
    fileId = up.body.id
    const got = await request(app.getHttpServer()).get(`/api/drive/files/${fileId}`).set('authorization', `Bearer ${c.clerk.token}`).buffer(true).parse((r, cb) => { const b: Buffer[] = []; r.on('data', (d) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))) })
    expect(got.status).toBe(200)
    expect(got.headers['content-type']).toBe('image/png')
    expect(got.headers['content-disposition']).toContain('inline')
    expect(Buffer.from(got.body).equals(PNG)).toBe(true)
    expect((await c.student.get(`/drive/files/${fileId}`)).status).toBe(403)
  })

  it('refuses a renamed program and keeps scripts as downloads only', async () => {
    const bad = await request(app.getHttpServer()).post('/api/drive/files').set('authorization', `Bearer ${c.teacher.token}`).attach('file', Buffer.from('MZ-not-a-picture'), 'virus.png')
    expect(bad.status).toBe(400)
    const html = await request(app.getHttpServer()).post('/api/drive/files').set('authorization', `Bearer ${c.teacher.token}`).attach('file', Buffer.from('<script>1</script>'), 'page.html')
    expect(html.status).toBe(400)
  })

  it('only the uploader or a storage manager can delete', async () => {
    expect((await c.teacher2.delete(`/drive/files/${fileId}`)).status).toBe(403)
    expect((await c.principal.delete(`/drive/files/${fileId}`)).status).toBe(200)
    expect(stored.has('D1')).toBe(false)
  })

  it('disconnecting removes the link', async () => {
    expect((await c.admin.post('/storage/drive/disconnect')).status).toBe(201)
    expect((await c.admin.get('/storage')).body.drive.configured).toBe(false)
    expect((await c.teacher.get('/drive/files')).body.connected).toBe(false)
  })
})
