import { INestApplication } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PASSWORD, clients, createApp, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app, 'a')
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const total = (r: { headers: Record<string, unknown> }) => Number(r.headers['x-total-count'])

describe('long lists say how many rows matched', () => {
  it('reports the real total next to the rows, and follows the filters', async () => {
    const all = await c.clerk.get('/students')
    expect(all.status).toBe(200)
    expect(total(all)).toBe(all.body.length)
    const one = await c.clerk.get('/students?q=student2')
    expect(total(one)).toBe(one.body.length)
    expect(total(one)).toBeLessThan(total(all))
    expect(total(await c.clerk.get(`/students?classId=${w.classB}`))).toBe(0)
  })

  it('shows a total for admissions and invoices too, including an empty list', async () => {
    const adm = await c.clerk.get('/admissions')
    expect(total(adm)).toBe(adm.body.length)
    const inv = await c.clerk.get('/fees/invoices')
    expect(total(inv)).toBe(inv.body.length)
    // A parent with no approved child sees nothing, and the total says so.
    await prisma.parentStudentLink.updateMany({ where: { parentId: w.u.parent }, data: { status: 'revoked' } })
    const none = await c.parent.get('/fees/invoices')
    expect(none.body).toEqual([])
    expect(total(none)).toBe(0)
  })

  it('when a list is cut off, the total is still the full count', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4)
    await prisma.user.createMany({
      data: Array.from({ length: 305 }, (_, i) => ({ schoolId: w.schoolId, email: `bulk${i}@a.test`, name: `Bulk ${String(i).padStart(3, '0')}`, role: 'student' as const, passwordHash: hash })),
    })
    // The default is 500, so 305 new students still all fit. The admin lowers the size and the cut-off appears.
    expect((await c.clerk.get('/students?q=bulk')).body).toHaveLength(305)
    expect((await c.admin.put('/school/list-limit', { listLimit: 300 })).status).toBe(200)
    const r = await c.clerk.get('/students')
    expect(r.body).toHaveLength(300)
    expect(total(r)).toBeGreaterThanOrEqual(307)
    const filtered = await c.clerk.get('/students?q=bulk')
    expect(filtered.body).toHaveLength(300)
    expect(total(filtered)).toBe(305)
    expect((await c.admin.put('/school/list-limit', { listLimit: 500 })).status).toBe(200)

    await prisma.invoice.createMany({
      data: Array.from({ length: 505 }, (_, i) => ({ schoolId: w.schoolId, studentId: w.u.student, classId: w.classA, title: `Fee ${i}`, amount: 1000, dueDate: new Date('2030-01-01'), createdById: w.u.clerk })),
    })
    const inv = await c.clerk.get('/fees/invoices')
    expect(inv.body).toHaveLength(500)
    expect(total(inv)).toBeGreaterThanOrEqual(505)
  })

  it('the school-only rule still holds: another school is not counted', async () => {
    const other = await seedWorld('B')
    const co = await clients(app, 'b')
    const r = await co.clerk.get('/students')
    expect(total(r)).toBe(r.body.length)
    expect(other.schoolId).not.toBe(w.schoolId)
  })
})

describe('the admin sets how many rows long lists send', () => {
  it('shows the current size, and only the admin can change it', async () => {
    const me = await c.admin.get('/school')
    expect(me.body).toMatchObject({ listLimit: 500, listLimitMin: 100, listLimitMax: 5000 })
    for (const r of ['principal', 'clerk', 'teacher', 'student', 'parent'] as const) expect((await c[r].put('/school/list-limit', { listLimit: 800 })).status, r).toBe(403)
    expect((await c.admin.get('/school')).body.listLimit).toBe(500)
  })

  it('accepts whole numbers from 100 to 5000, saves them, and records the change', async () => {
    expect((await c.admin.put('/school/list-limit', { listLimit: 1200 })).body).toMatchObject({ listLimit: 1200 })
    expect((await c.admin.get('/school')).body.listLimit).toBe(1200)
    const log = await prisma.auditLog.findFirst({ where: { action: 'school.list_limit_changed', schoolId: w.schoolId }, orderBy: { createdAt: 'desc' } })
    expect(log?.meta).toEqual({ from: 500, to: 1200 })
    for (const bad of [99, 5001, 0, -5, 250.5, '800', null]) expect((await c.admin.put('/school/list-limit', { listLimit: bad as any })).status, String(bad)).toBe(400)
    expect((await c.admin.put('/school/list-limit', {})).status).toBe(400)
    expect((await c.admin.put('/school/list-limit', { listLimit: 100 })).status).toBe(200)
    expect((await c.admin.put('/school/list-limit', { listLimit: 5000 })).status).toBe(200)
    await c.admin.put('/school/list-limit', { listLimit: 500 })
  })

  it('applies to invoices, and does not change another school', async () => {
    await c.admin.put('/school/list-limit', { listLimit: 100 })
    const inv = await c.clerk.get('/fees/invoices')
    expect(inv.body).toHaveLength(100)
    expect(total(inv)).toBeGreaterThanOrEqual(505)
    const cb = await clients(app, 'b')
    expect((await cb.admin.get('/school')).body.listLimit).toBe(500)
    await c.admin.put('/school/list-limit', { listLimit: 500 })
  })
})
