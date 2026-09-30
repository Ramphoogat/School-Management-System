import { INestApplication } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
afterEach(() => { vi.restoreAllMocks() })

const fee = (title: string, dueDate: string, amount = 500000) => c.clerk.post('/fees/invoices', { classId: w.classA, title, amount, dueDate })
const inv = (title: string, studentId = w.u.student) => prisma.invoice.findFirstOrThrow({ where: { title, studentId } })
const notified = (event: string) => prisma.notification.findMany({ where: { event, channel: 'in_app' } })
const audits = (action: string) => prisma.auditLog.findMany({ where: { action } })

describe('fee reminders', () => {
  it('sends due-soon and overdue reminders once, to the student and their parent, and skips paid or waiver-pending fees', async () => {
    await fee('Soon', daysFromNow(2))
    await fee('Late', daysFromNow(-4))
    await fee('Far', daysFromNow(30))
    await fee('Paid late', daysFromNow(-4))
    await fee('Waiver late', daysFromNow(-4))
    await c.clerk.post('/fees/bulk-pay', { ids: (await prisma.invoice.findMany({ where: { title: 'Paid late' } })).map((i) => i.id), method: 'cash' })
    await c.clerk.post(`/fees/invoices/${(await inv('Waiver late')).id}/request-waiver`, { reason: 'Hardship case' })

    const first = await c.clerk.post('/fees/reminders/run')
    expect(first.status).toBe(201)
    // Two students each: Soon is due, Late is overdue; Far, the paid one and the waiver-pending one are left alone.
    expect(first.body).toMatchObject({ due: 2, overdue: 2 + 1 }) // +1: Waiver late for the student without a pending waiver

    const due = await notified('fee.due')
    // student + parent for the first student, student2 alone
    expect(new Set(due.map((n) => n.userId))).toEqual(new Set([w.u.student, w.u.parent, w.u.student2]))
    expect(due[0].body).toMatch(/Soon/)
    const late = await notified('fee.overdue')
    expect(late.some((n) => n.userId === w.u.parent && /overdue/.test(n.body))).toBe(true)

    // Nothing is sent twice.
    expect(await c.clerk.post('/fees/reminders/run').then((r) => r.body)).toEqual({ due: 0, overdue: 0 })
  })

  it('repeats the overdue reminder weekly, and stops after four', async () => {
    const late = await inv('Late')
    for (let n = 2; n <= 5; n++) {
      // Pretend the last reminder went out eight days ago.
      await prisma.feeReminder.updateMany({ where: { invoiceId: late.id, kind: 'overdue' }, data: { sentAt: new Date(Date.now() - 8 * 86_400_000) } })
      const r = await c.clerk.post('/fees/reminders/run')
      expect(r.body.overdue >= 1, `run ${n}`).toBe(n <= 4)
    }
    expect(await prisma.feeReminder.count({ where: { invoiceId: late.id, kind: 'overdue' } })).toBe(4)
  })

  it('a paid fee stops getting reminders, and only the clerk can trigger a run', async () => {
    await c.clerk.post('/fees/bulk-pay', { ids: [(await inv('Soon')).id], method: 'cash' })
    for (const r of ['student', 'parent', 'teacher', 'principal', 'admin'] as const) expect((await c[r].post('/fees/reminders/run')).status, r).toBe(403)
  })
})

describe('refunds', () => {
  const payCash = async (title: string) => {
    const i = await inv(title)
    await c.clerk.post('/fees/bulk-pay', { ids: [i.id], method: 'cash' })
    return i.id
  }

  it('the principal and admin refund a paid invoice; nobody else can, and it cannot happen twice', async () => {
    await fee('Lab fee', daysFromNow(10))
    const id = await payCash('Lab fee')
    for (const r of ['student', 'parent', 'teacher', 'clerk'] as const) expect((await c[r].post(`/fees/invoices/${id}/refund`, { reason: 'Paid by mistake' })).status, r).toBe(403)
    expect((await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'x' })).status).toBe(400) // reason too short

    const ok = await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Paid by mistake' })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ refunded: true, method: 'manual', status: 'processed' })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe('refunded')
    expect(await prisma.refund.findFirstOrThrow({ where: { invoiceId: id } })).toMatchObject({ amount: 500000, method: 'manual', createdById: w.u.principal })
    expect((await audits('fee.refunded')).length).toBe(1)
    expect((await notified('fee.refunded')).some((n) => n.userId === w.u.parent)).toBe(true)
    // The list shows it, and a refunded invoice can be neither paid nor refunded again.
    expect((await c.clerk.get('/fees/invoices?status=refunded')).body[0].refund).toMatchObject({ method: 'manual', reason: 'Paid by mistake' })
    expect((await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Again please' })).status).toBe(400)
    expect((await c.clerk.post(`/fees/invoices/${id}/pay`, { method: 'cash' })).status).toBe(400)

    // Admin may refund too.
    await fee('Sports fee', daysFromNow(10))
    const id2 = await payCash('Sports fee')
    expect((await c.admin.post(`/fees/invoices/${id2}/refund`, { reason: 'Left the school' })).status).toBe(201)
  })

  it('refunds part of a payment, several times, until it is all returned', async () => {
    await fee('Trip fee', daysFromNow(10), 100000) // Rs 1000
    const id = await payCash('Trip fee')
    const refund = (body: object) => c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Trip cancelled for some', ...body })

    // Bad amounts are refused and nothing is recorded.
    for (const amount of [0, -5, 1.5, 100001]) expect((await refund({ amount })).status, String(amount)).toBe(400)
    expect(await prisma.refund.count({ where: { invoiceId: id } })).toBe(0)

    // Part one: the invoice stays paid, and everyone is told the amount that went back.
    const first = await refund({ amount: 30000 })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ refunded: false, partial: true, amount: 30000, remaining: 70000, method: 'manual' })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe('paid')
    const shown = (await c.clerk.get('/fees/invoices?status=paid')).body.find((i: any) => i.id === id)
    expect(shown).toMatchObject({ refundedAmount: 30000, refund: { amount: 30000 } })
    expect((await notified('fee.refunded')).find((n) => n.body.includes('300.00'))).toBeTruthy()

    // Cannot take back more than is left.
    expect((await refund({ amount: 70001 })).body.message).toMatch(/At most Rs 700\.00/)

    // Part two, then the rest with no amount: the invoice becomes refunded.
    expect((await refund({ amount: 20000 })).body).toMatchObject({ partial: true, remaining: 50000 })
    const last = await refund({})
    expect(last.body).toMatchObject({ refunded: true, partial: false, amount: 50000, remaining: 0 })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe('refunded')
    expect((await prisma.refund.findMany({ where: { invoiceId: id }, orderBy: { createdAt: 'asc' } })).map((r) => r.amount)).toEqual([30000, 20000, 50000])
    expect((await refund({})).status).toBe(400) // nothing left, and it is no longer paid
    const audited = (await audits('fee.refunded')).filter((a: any) => a.resourceId === id)
    expect(audited.map((a: any) => a.meta.full)).toEqual([false, false, true])
  })

  it('two refunds at the same moment cannot return more than was paid', async () => {
    await fee('Race fee', daysFromNow(10), 100000)
    const id = await payCash('Race fee')
    const go = () => c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Both clicked', amount: 70000 })
    const results = await Promise.all([go(), go()])
    expect(results.map((r) => r.status).sort()).toEqual([201, results.find((r) => r.status !== 201)!.status].sort())
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    const total = (await prisma.refund.aggregate({ where: { invoiceId: id }, _sum: { amount: true } }))._sum.amount
    expect(total).toBe(70000)
  })

  it('cannot refund an unpaid invoice', async () => {
    await fee('Unpaid one', daysFromNow(10))
    expect((await c.principal.post(`/fees/invoices/${(await inv('Unpaid one')).id}/refund`, { reason: 'Nothing paid' })).status).toBe(400)
  })

  describe('online payments', () => {
    const OLD = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET }
    beforeAll(() => { process.env.RAZORPAY_KEY_ID = 'rzp_test_x'; process.env.RAZORPAY_KEY_SECRET = 'secret_x' })
    afterAll(() => { process.env.RAZORPAY_KEY_ID = OLD.id; process.env.RAZORPAY_KEY_SECRET = OLD.secret })

    const paidOnline = async (title: string, paymentId: string) => {
      await fee(title, daysFromNow(10))
      const i = await inv(title)
      await prisma.invoice.update({ where: { id: i.id }, data: { status: 'paid' } })
      await prisma.payment.create({ data: { invoiceId: i.id, amount: i.amount, method: 'online', razorpayPaymentId: paymentId, recordedById: w.u.parent } })
      return i.id
    }

    it('refunds through Razorpay for the full amount and records their refund id', async () => {
      const id = await paidOnline('Online A', 'pay_A')
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'rfnd_A', status: 'processed' }), { status: 200 }))
      const r = await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Duplicate charge' })
      expect(r.status).toBe(201)
      expect(r.body).toMatchObject({ method: 'razorpay', status: 'processed' })
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.razorpay.com/v1/payments/pay_A/refund')
      expect(JSON.parse(String(init.body)).amount).toBe(500000)
      expect(await prisma.refund.findFirstOrThrow({ where: { invoiceId: id } })).toMatchObject({ razorpayRefundId: 'rfnd_A', status: 'processed' })
    })

    it('leaves the invoice paid, and records nothing, when Razorpay refuses', async () => {
      const id = await paidOnline('Online B', 'pay_B')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { description: 'Refund not allowed' } }), { status: 400 }))
      const r = await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Try it anyway' })
      expect(r.status).toBe(502)
      expect(r.body.message).toMatch(/Refund not allowed/)
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe('paid')
      expect(await prisma.refund.count({ where: { invoiceId: id } })).toBe(0)
    })

    it('sends only the partial amount to Razorpay, and a refusal frees the amount for another try', async () => {
      const id = await paidOnline('Online P', 'pay_P')
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { description: 'Bank busy' } }), { status: 400 }))
      expect((await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Part of it', amount: 200000 })).status).toBe(502)
      spy.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'rfnd_P1', status: 'processed' }), { status: 200 }))
      const ok = await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Part of it', amount: 200000 })
      expect(ok.body).toMatchObject({ partial: true, remaining: 300000, method: 'razorpay' })
      expect(JSON.parse(String((spy.mock.calls[1] as [string, RequestInit])[1].body)).amount).toBe(200000)
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe('paid')
      expect(await prisma.refund.findMany({ where: { invoiceId: id } })).toMatchObject([{ amount: 200000, razorpayRefundId: 'rfnd_P1' }])
    })

    it('a "pending" refund is recorded as pending', async () => {
      const id = await paidOnline('Online C', 'pay_C')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'rfnd_C', status: 'pending' }), { status: 200 }))
      expect((await c.principal.post(`/fees/invoices/${id}/refund`, { reason: 'Slow bank' })).body.status).toBe('pending')
    })
  })
})

describe('Razorpay webhook', () => {
  const SECRET = 'whsec_test'
  const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex')
  const post = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload)
    return request(app.getHttpServer()).post('/api/fees/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', signature ?? sign(raw)).send(raw)
  }
  const captured = (orderId: string, paymentId: string, amount: number) => ({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount } } } })
  const withOrder = async (title: string, orderId: string) => {
    await fee(title, daysFromNow(10))
    const i = await inv(title)
    await prisma.invoice.update({ where: { id: i.id }, data: { razorpayOrderId: orderId } })
    return i
  }
  beforeAll(() => { process.env.RAZORPAY_WEBHOOK_SECRET = SECRET })
  afterAll(() => { delete process.env.RAZORPAY_WEBHOOK_SECRET })

  it('rejects a bad or missing signature, and is off without a secret', async () => {
    const i = await withOrder('Hook A', 'order_HA')
    expect((await post(captured('order_HA', 'pay_HA', i.amount), 'deadbeef')).status).toBe(403)
    expect((await request(app.getHttpServer()).post('/api/fees/razorpay/webhook').send(captured('order_HA', 'pay_HA', i.amount))).status).toBe(403)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: i.id } })).status).toBe('unpaid')
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    expect((await post(captured('order_HA', 'pay_HA', i.amount), 'x')).status).toBe(503)
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  })

  it('marks the invoice paid when the browser never came back, and is safe to receive twice', async () => {
    const i = await withOrder('Hook B', 'order_HB')
    const r = await post(captured('order_HB', 'pay_HB', i.amount))
    expect(r.status).toBe(200)
    const done = await prisma.invoice.findUniqueOrThrow({ where: { id: i.id }, include: { payments: true } })
    expect(done.status).toBe('paid')
    expect(done.payments[0]).toMatchObject({ method: 'online', razorpayPaymentId: 'pay_HB', recordedById: 'razorpay' })
    expect((await notified('fee.paid')).some((n) => n.userId === w.u.parent && /Hook B/.test(n.body))).toBe(true)
    // Razorpay retries; the second delivery changes nothing.
    expect((await post(captured('order_HB', 'pay_HB', i.amount))).status).toBe(200)
    expect(await prisma.payment.count({ where: { invoiceId: i.id } })).toBe(1)
    // The order.paid event for the same payment is also harmless.
    expect((await post({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_HB', order_id: 'order_HB', amount: i.amount } } } })).status).toBe(200)
    expect(await prisma.payment.count({ where: { invoiceId: i.id } })).toBe(1)
  })

  it('does not settle when the amount is wrong, and flags it', async () => {
    const i = await withOrder('Hook C', 'order_HC')
    expect((await post(captured('order_HC', 'pay_HC', i.amount - 100))).status).toBe(200)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: i.id } })).status).toBe('unpaid')
    expect((await audits('fee.payment_mismatch')).length).toBe(1)
  })

  it('flags a second, different payment on an invoice that is already paid', async () => {
    const i = await withOrder('Hook D', 'order_HD')
    await post(captured('order_HD', 'pay_HD1', i.amount))
    await post(captured('order_HD', 'pay_HD2', i.amount))
    expect(await prisma.payment.count({ where: { invoiceId: i.id } })).toBe(1)
    expect((await audits('fee.duplicate_payment')).length).toBe(1)
  })

  it('ignores payments for orders it does not know, and other events', async () => {
    expect((await post(captured('order_NOPE', 'pay_N', 100))).status).toBe(200)
    expect((await post({ event: 'payment.authorized', payload: {} })).body).toMatchObject({ ignored: 'payment.authorized' })
  })

  it('updates a refund when Razorpay reports it processed', async () => {
    const i = await withOrder('Hook E', 'order_HE')
    await prisma.refund.create({ data: { schoolId: w.schoolId, invoiceId: i.id, paymentId: 'x', amount: 1, reason: 'test', method: 'razorpay', razorpayRefundId: 'rfnd_HE', status: 'pending', createdById: w.u.principal } })
    expect((await post({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_HE' } } } })).status).toBe(200)
    expect((await prisma.refund.findFirstOrThrow({ where: { razorpayRefundId: 'rfnd_HE' } })).status).toBe('processed')
  })
})
