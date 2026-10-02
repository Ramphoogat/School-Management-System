import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld } from './helpers'

let app: INestApplication
let c: Awaited<ReturnType<typeof clients>>
let cam: Server
let base: string
let camId: string

beforeAll(async () => {
  await resetDb()
  await seedWorld('A')
  app = await createApp()
  c = await clients(app, 'a')
  cam = createServer((req, res) => {
    if (req.url?.startsWith('/gate/index.m3u8')) res.setHeader('content-type', 'application/vnd.apple.mpegurl').end('#EXTM3U\nseg1.ts\n')
    else if (req.url?.startsWith('/gate/seg1.ts')) res.setHeader('content-type', 'video/mp2t').end('VIDEO')
    else if (req.url === '/secret.txt') res.end('outside the folder')
    else res.statusCode = 404, res.end()
  })
  await new Promise<void>((r) => cam.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(cam.address() as AddressInfo).port}`
})
afterAll(async () => { await app.close(); cam.close(); await prisma.$disconnect() })

describe('school cameras', () => {
  it('only the principal and admin can see or manage them', async () => {
    for (const who of ['student', 'parent', 'teacher', 'clerk'] as const) {
      expect((await c[who].get('/cameras')).status).toBe(403)
      expect((await c[who].post('/cameras', { name: 'x', kind: 'hls', sourceUrl: `${base}/gate/index.m3u8` })).status).toBe(403)
    }
    const made = await c.principal.post('/cameras', { name: 'Main gate', location: 'Entrance', kind: 'hls', sourceUrl: `${base}/gate/index.m3u8?key=abc` })
    expect(made.status).toBe(201)
    camId = made.body.id
    expect((await c.admin.get('/cameras')).body.cameras).toHaveLength(1)
  })

  it('never shows the stream address in full, and rejects rtsp', async () => {
    const list = await c.admin.get('/cameras')
    expect(JSON.stringify(list.body)).not.toContain('abc')
    expect((await c.admin.post('/cameras', { name: 'r', kind: 'hls', sourceUrl: 'rtsp://10.0.0.5/live' })).status).toBe(400)
  })

  it('relays video only to a signed-in principal or admin', async () => {
    const url = `/api/cameras/${camId}/hls/index.m3u8`
    expect((await request(app.getHttpServer()).get(url)).status).toBe(401)
    expect((await request(app.getHttpServer()).get(url).set('authorization', `Bearer ${c.teacher.token}`)).status).toBe(403)
    const pl = await request(app.getHttpServer()).get(url).set('authorization', `Bearer ${c.principal.token}`)
    expect(pl.status).toBe(200)
    expect(pl.text).toContain('seg1.ts')
    const seg = await request(app.getHttpServer()).get(`/api/cameras/${camId}/hls/seg1.ts`).set('authorization', `Bearer ${c.admin.token}`)
    expect(Buffer.from(seg.body).toString()).toBe('VIDEO')
  })

  it('cannot be steered outside the camera folder', async () => {
    const r = await request(app.getHttpServer()).get(`/api/cameras/${camId}/hls/..%2Fsecret.txt`).set('authorization', `Bearer ${c.admin.token}`)
    expect(r.status).not.toBe(200)
    expect(r.text).not.toContain('outside')
  })

  it('a viewing link works for that camera only, and opening is logged', async () => {
    expect((await c.teacher.post(`/cameras/${camId}/open`)).status).toBe(403)
    const o = await c.principal.post(`/cameras/${camId}/open`)
    expect(o.status).toBe(201)
    const ok = await request(app.getHttpServer()).get(`/api/cameras/${camId}/hls/index.m3u8`).set('x-camera-token', o.body.token)
    expect(ok.status).toBe(200)
    const other = await c.admin.post('/cameras', { name: 'Hall', kind: 'mjpeg', sourceUrl: `${base}/gate/seg1.ts` })
    expect((await request(app.getHttpServer()).get(`/api/cameras/${other.body.id}/mjpeg?t=${o.body.token}`)).status).toBe(401)
    expect(await prisma.auditLog.count({ where: { action: 'camera.viewed' } })).toBe(1)
  })

  it('a switched-off camera gives no picture', async () => {
    await c.admin.patch(`/cameras/${camId}`, { enabled: false })
    expect((await request(app.getHttpServer()).get(`/api/cameras/${camId}/hls/index.m3u8`).set('authorization', `Bearer ${c.admin.token}`)).status).toBe(404)
    expect((await c.admin.post(`/cameras/${camId}/open`)).status).toBe(400)
  })
})
