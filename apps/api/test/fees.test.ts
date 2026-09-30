import { INestApplication } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The signature helper is a pure function, so it is tested directly.
import { verifyRazorpaySignature } from '@dist/fees/fees.module'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const createFee = (title = 'Term 1', amount = 500000, dueDate = daysFromNow(-10)) => c.clerk.post('/fees/invoices', { classId: w.classA, title, amount, dueDate })
const invoiceIds = async (title?: string) => (await prisma.invoice.findMany({ where: { schoolId: w.schoolId, ...(title ? { title } : {}) } })).map((i) => i.id)

describe('fees: invoices', () => {
  it('only the clerk can create invoices; one per student, and re-running skips duplicates', async () => {
    for (const r of ['teacher', 'student', 'parent', 'principal', 'admin'] as const) {
      expect((await c[r].post('/fees/invoices', { classId: w.classA, title: 'X', amount: 100, dueDate: daysFromNow(5) })).status, r).toBe(403)
    }
    const first = await createFee()
    expect(first.body).toEqual({ created: 2, skipped: 0 })
    expect((await createFee()).body).toEqual({ created: 0, skipped: 2 })
  })

  it('validates amount (in paise) and date', async () => {
    expect((await createFee('Bad', 50)).status).toBe(400)
    expect((await createFee('Bad', 1000, 'soon')).status).toBe(400)
  })

  it('shows students only their own invoices and parents only their linked children', async () => {
    const own = await c.student.get('/fees/invoices')
    expect(own.body.map((i: any) => i.studentId)).toEqual([w.u.student])
    const s2 = await c.student2.get('/fees/invoices')
    expect(s2.body.map((i: any) => i.studentId)).toEqual([w.u.student2])
    const parent = await c.parent.get('/fees/invoices')
    expect(parent.body.map((i: any) => i.studentId)).toEqual([w.u.student])
    // A filter cannot be used to peek at someone else.
    expect((await c.student.get(`/fees/invoices?studentId=${w.u.student2}`)).body).toEqual([])
    expect((await c.parent.get(`/fees/invoices?studentId=${w.u.student2}`)).body).toEqual([])
    expect((await c.clerk.get('/fees/invoices')).body).toHaveLength(2)
  })

  it('flags overdue invoices and filters by status', async () => {
    const overdue = await c.clerk.get('/fees/invoices?status=overdue')
    expect(overdue.body).toHaveLength(2)
    expect(overdue.body.every((i: any) => i.overdue)).toBe(true)
    await createFee('Future', 1000, daysFromNow(20))
    const future = (await c.clerk.get('/fees/invoices?status=unpaid')).body.filter((i: any) => i.title === 'Future')
    expect(future.every((i: any) => !i.overdue)).toBe(true)
  })
})

describe('fees: recording payments', () => {
  it('bulk mark-paid works for the clerk, reports partial failures, and sends receipts', async () => {
    const ids = await invoiceIds('Term 1')
    await prisma.notification.deleteMany({})
    const res = await c.clerk.post('/fees/bulk-pay', { ids: [...ids, 'bogus'], method: 'cash', reference: 'Book 4' })
    expect(res.body).toMatchObject({ total: 3, succeeded: 2 })
    expect(res.body.failed[0]).toMatchObject({ id: 'bogus', error: 'Not found' })
    const invs = await prisma.invoice.findMany({ where: { id: { in: ids } }, include: { payments: true } })
    expect(invs.every((i) => i.status === 'paid' && i.payments.length === 1 && i.payments[0].method === 'cash')).toBe(true)
    expect(await prisma.notification.count({ where: { event: 'fee.paid', channel: 'in_app' } })).toBe(3) // student, student2, parent
    expect(await prisma.auditLog.count({ where: { bulkId: res.body.bulkId, action: 'fee.paid' } })).toBe(2)
  })

  it('cannot pay the same invoice twice', async () => {
    const ids = await invoiceIds('Term 1')
    const again = await c.clerk.post('/fees/bulk-pay', { ids, method: 'upi' })
    expect(again.body.succeeded).toBe(0)
    expect(again.body.failed[0].error).toMatch(/already paid/i)
    expect(await prisma.payment.count({ where: { invoiceId: { in: ids } } })).toBe(2)
  })

  it('only the clerk can record payments', async () => {
    const [future] = await invoiceIds('Future')
    for (const r of ['teacher', 'student', 'parent', 'principal', 'admin'] as const) {
      expect((await c[r].post('/fees/bulk-pay', { ids: [future], method: 'cash' })).status, r).toBe(403)
      expect((await c[r].post(`/fees/invoices/${future}/pay`, { method: 'cash' })).status, r).toBe(403)
    }
    expect((await c.clerk.post('/fees/bulk-pay', { ids: [future], method: 'barter' })).status).toBe(400)
    expect((await prisma.invoice.findUnique({ where: { id: future } }))!.status).toBe('unpaid')
  })
})

describe('fees: waivers', () => {
  it('clerk requests, principal decides in bulk with a required shared note, and a waived invoice cannot be paid', async () => {
    await createFee('Lab', 20000, daysFromNow(3))
    const [a, b] = await invoiceIds('Lab')
    expect((await c.clerk.post(`/fees/invoices/${a}/request-waiver`, { reason: 'x' })).status).toBe(400)
    expect((await c.clerk.post(`/fees/invoices/${a}/request-waiver`, { reason: 'Scholarship' })).status).toBe(201)
    expect((await c.clerk.post(`/fees/invoices/${a}/request-waiver`, { reason: 'Scholarship' })).status).toBe(400) // already pending
    await c.clerk.post(`/fees/invoices/${b}/request-waiver`, { reason: 'Hardship' })

    expect((await c.principal.post('/fees/waivers/bulk-approve', { ids: [a, b], decision: 'approve' })).status).toBe(400)
    const res = await c.principal.post('/fees/waivers/bulk-approve', { ids: [a, b, 'bogus'], decision: 'approve', reason: 'Approved by committee' })
    expect(res.body).toMatchObject({ total: 3, succeeded: 2 })
    const rows = await prisma.invoice.findMany({ where: { id: { in: [a, b] } } })
    expect(rows.every((r) => r.status === 'waived' && r.waiverNote === 'Approved by committee')).toBe(true)

    const pay = await c.clerk.post('/fees/bulk-pay', { ids: [a], method: 'cash' })
    expect(pay.body.failed[0].error).toMatch(/already waived/i)
  })

  it('a declined waiver leaves the invoice payable', async () => {
    await createFee('Trip', 30000, daysFromNow(3))
    const [t] = await invoiceIds('Trip')
    await c.clerk.post(`/fees/invoices/${t}/request-waiver`, { reason: 'Please' })
    await c.principal.post('/fees/waivers/bulk-approve', { ids: [t], decision: 'reject', reason: 'Not eligible' })
    const inv = await prisma.invoice.findUnique({ where: { id: t } })
    expect(inv).toMatchObject({ status: 'unpaid', waiverStatus: 'rejected', waiverNote: 'Not eligible' })
    expect((await c.clerk.post('/fees/bulk-pay', { ids: [t], method: 'cash' })).body.succeeded).toBe(1)
  })

  it('only the principal decides waivers; admin, teacher, parent and student cannot', async () => {
    await createFee('Books', 10000, daysFromNow(3))
    const [x] = await invoiceIds('Books')
    await c.clerk.post(`/fees/invoices/${x}/request-waiver`, { reason: 'Need' })
    for (const r of ['admin', 'teacher', 'parent', 'student', 'clerk'] as const) {
      expect((await c[r].post('/fees/waivers/bulk-approve', { ids: [x], decision: 'approve', reason: 'ok ok' })).status, r).toBe(403)
      expect((await c[r].get('/fees/waivers')).status, r).toBe(403)
    }
    expect((await c.principal.get('/fees/waivers')).status).toBe(200)
  })
})

describe('fees: online payment (Razorpay)', () => {
  const KEY = 'rzp_test_abc'
  const SECRET = 'shhh-secret'
  const sign = (order: string, pay: string, secret = SECRET) => createHmac('sha256', secret).update(`${order}|${pay}`).digest('hex')

  it('is reported as off, and refuses to start a payment, when no keys are set', async () => {
    expect((await c.parent.get('/fees/config')).body).toMatchObject({ razorpay: false })
    const [inv] = await invoiceIds('Future')
    const res = await c.parent.post(`/fees/invoices/${inv}/online-order`)
    expect(res.status).toBe(503)
  })

  it('verifies signatures correctly', () => {
    const good = sign('order_1', 'pay_1')
    expect(verifyRazorpaySignature('order_1', 'pay_1', good, SECRET)).toBe(true)
    expect(verifyRazorpaySignature('order_1', 'pay_2', good, SECRET)).toBe(false)
    expect(verifyRazorpaySignature('order_2', 'pay_1', good, SECRET)).toBe(false)
    expect(verifyRazorpaySignature('order_1', 'pay_1', good, 'other-secret')).toBe(false)
    expect(verifyRazorpaySignature('order_1', 'pay_1', 'short', SECRET)).toBe(false)
    expect(verifyRazorpaySignature('order_1', 'pay_1', '', SECRET)).toBe(false)
  })

  describe('with keys configured', () => {
    beforeAll(() => { process.env.RAZORPAY_KEY_ID = KEY; process.env.RAZORPAY_KEY_SECRET = SECRET })
    afterAll(() => { process.env.RAZORPAY_KEY_ID = ''; process.env.RAZORPAY_KEY_SECRET = '' })

    it('marks an invoice paid only after a valid signature for the right order', async () => {
      const [inv] = await invoiceIds('Future')
      await prisma.invoice.update({ where: { id: inv }, data: { razorpayOrderId: 'order_X' } })
      const url = `/fees/invoices/${inv}/online-verify`
      const bad = await c.parent.post(url, { razorpay_order_id: 'order_X', razorpay_payment_id: 'pay_X', razorpay_signature: sign('order_X', 'pay_X', 'wrong') })
      expect(bad.status).toBe(400)
      const wrongOrder = await c.parent.post(url, { razorpay_order_id: 'order_Y', razorpay_payment_id: 'pay_X', razorpay_signature: sign('order_Y', 'pay_X') })
      expect(wrongOrder.status).toBe(400)
      expect((await prisma.invoice.findUnique({ where: { id: inv } }))!.status).toBe('unpaid')

      const ok = await c.parent.post(url, { razorpay_order_id: 'order_X', razorpay_payment_id: 'pay_X', razorpay_signature: sign('order_X', 'pay_X') })
      expect(ok.status).toBe(201)
      const done = await prisma.invoice.findUnique({ where: { id: inv }, include: { payments: true } })
      expect(done!.status).toBe('paid')
      expect(done!.payments[0]).toMatchObject({ method: 'online', razorpayPaymentId: 'pay_X' })
      // A replay cannot pay twice.
      const replay = await c.parent.post(url, { razorpay_order_id: 'order_X', razorpay_payment_id: 'pay_X', razorpay_signature: sign('order_X', 'pay_X') })
      expect(replay.status).toBe(400)
    })

    it("parents cannot pay someone else's child, and students and staff cannot use the online flow", async () => {
      const inv2 = (await prisma.invoice.findFirst({ where: { studentId: w.u.student2, status: 'unpaid' } }))!
      await prisma.invoice.update({ where: { id: inv2.id }, data: { razorpayOrderId: 'order_Z' } })
      const body = { razorpay_order_id: 'order_Z', razorpay_payment_id: 'pay_Z', razorpay_signature: sign('order_Z', 'pay_Z') }
      for (const r of ['parent', 'student2', 'clerk', 'principal'] as const) {
        expect((await c[r].post(`/fees/invoices/${inv2.id}/online-verify`, body)).status, r).toBe(403)
      }
      expect((await prisma.invoice.findUnique({ where: { id: inv2.id } }))!.status).toBe('unpaid')
    })
  })
})
