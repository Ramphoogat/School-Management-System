import { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let wb: World
let c: Awaited<ReturnType<typeof clients>>

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  wb = await seedWorld('B')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('id cards: bulk generate', () => {
  it('only the clerk can generate', async () => {
    const body = { studentIds: [w.u.student] }
    for (const r of ['teacher', 'student', 'parent', 'principal', 'admin'] as const) expect((await c[r].post('/id-cards/bulk', body)).status, r).toBe(403)
    expect((await c.clerk.post('/id-cards/bulk', body)).status).toBe(201)
  })

  it('returns a stable card with class and guardian, and audits the bulk action', async () => {
    const body = { studentIds: [w.u.student, w.u.student2] }
    const a = await c.clerk.post('/id-cards/bulk', body)
    const b = await c.clerk.post('/id-cards/bulk', body)
    expect(a.body.succeeded).toBe(2)
    const card = a.body.cards.find((x: any) => x.studentId === w.u.student)
    expect(card.number).toMatch(/^ID-\d{4}-[0-9A-Z]{6}$/)
    expect(card.className).toBeTruthy()
    expect(card.guardian).toBeTruthy()
    expect(b.body.cards.find((x: any) => x.studentId === w.u.student).number).toBe(card.number)
    expect(await prisma.auditLog.count({ where: { bulkId: a.body.bulkId, action: 'idcards.bulk_generate' } })).toBe(1)
    expect(await prisma.bulkActionLog.count({ where: { id: a.body.bulkId, resource: 'idcard' } })).toBe(1)
  })

  it('reports unknown ids, non-students and other schools instead of issuing them', async () => {
    const res = await c.clerk.post('/id-cards/bulk', { studentIds: [w.u.student, w.u.parent, 'ghost', wb.u.student] })
    expect(res.body.succeeded).toBe(1)
    expect(res.body.failed.map((f: any) => f.studentId).sort()).toEqual([w.u.parent, 'ghost', wb.u.student].sort())
  })

  it('rejects an empty selection', async () => {
    expect((await c.clerk.post('/id-cards/bulk', { studentIds: [] })).status).toBe(400)
  })
})
