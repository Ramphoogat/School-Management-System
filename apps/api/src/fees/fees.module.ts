import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Query, Req, Res, ServiceUnavailableException, UseGuards, type RawBodyRequest } from '@nestjs/common'
import type { Request, Response } from 'express'
import { listLimit, setTotal } from '../common/total'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const METHODS = ['cash', 'upi', 'card', 'bank', 'cheque']

class CreateInvoicesDto {
  @IsString() classId: string
  @IsString() @MinLength(1) title: string
  /** Amount in paise (1 rupee = 100 paise). */
  @IsInt() @Min(100) amount: number
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate: string
}
class BulkPayDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
  @IsIn(METHODS) method: string
  @IsOptional() @IsString() reference?: string
}
class WaiverRequestDto {
  @IsString() @MinLength(3) reason: string
}
class WaiverDecideDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject'
  /** Waivers always carry a shared note, stored against every affected invoice. */
  @IsString() @MinLength(3) reason: string
}
class RefundDto {
  @IsString() @MinLength(3) reason: string
  /** In paise. Leave out to refund everything still refundable on the invoice. */
  @IsOptional() @IsInt() @Min(1) amount?: number
}
class VerifyDto {
  @IsString() razorpay_order_id: string
  @IsString() razorpay_payment_id: string
  @IsString() razorpay_signature: string
}

export function razorpayConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

/** Razorpay checkout signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

const isOverdue = (i: { status: string; dueDate: Date }) => i.status === 'unpaid' && i.dueDate < new Date(new Date().toISOString().slice(0, 10))

const razorpayAuth = () => `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`

/** Razorpay signs webhook bodies with HMAC-SHA256 of the exact raw bytes, using the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(signature ?? '')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The one place an invoice becomes paid, whether the office marks it, checkout verifies it, or the webhook reports it. */
@Injectable()
export class FeesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus) {}

  async settle(o: { actorId: string; id: string; method: string; reference?: string; bulkId?: string; razorpayPaymentId?: string; allow?: (inv: { schoolId: string }) => boolean }) {
    try {
      let paid: { studentId: string; title: string; amount: number; schoolId: string } | null = null
      await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.findUnique({ where: { id: o.id } })
        if (!inv) throw new Error('Not found')
        if (o.allow && !o.allow(inv)) throw new Error('Not permitted')
        if (inv.status !== 'unpaid') throw new Error(`Already ${inv.status}`)
        const upd = await tx.invoice.updateMany({ where: { id: o.id, status: 'unpaid' }, data: { status: 'paid' } })
        if (upd.count !== 1) throw new Error('Status changed')
        await tx.payment.create({ data: { invoiceId: o.id, amount: inv.amount, method: o.method, reference: o.reference ?? null, razorpayPaymentId: o.razorpayPaymentId ?? null, recordedById: o.actorId } })
        await this.audit.log(tx, { schoolId: inv.schoolId, actorId: o.actorId, action: 'fee.paid', resource: 'invoice', resourceId: o.id, bulkId: o.bulkId, meta: { method: o.method, amount: inv.amount } })
        paid = { studentId: inv.studentId, title: inv.title, amount: inv.amount, schoolId: inv.schoolId }
      })
      if (paid) await this.bus.emit('fee.paid', { ...(paid as any), invoiceId: o.id, actorId: o.actorId })
      return { id: o.id, ok: true as const }
    } catch (e) {
      return { id: o.id, ok: false as const, error: (e as Error).message }
    }
  }
}

/**
 * Sends "due soon" and "overdue" reminders to the student and their parents. Each stage is sent once per invoice
 * (overdue repeats weekly, at most 4 times), recorded in FeeReminder so restarts never send twice.
 */
export const DUE_DAYS = 3
export const OVERDUE_EVERY_DAYS = 7
export const OVERDUE_MAX = 4

@Injectable()
export class FeeReminders implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('FeeReminders')
  private timer?: NodeJS.Timeout
  constructor(private prisma: PrismaService, private bus: EventBus) {}

  onModuleInit() {
    if (process.env.FEE_REMINDERS === 'off') return
    // Hourly check, but only in daytime so nobody is messaged at 3am. Deduplication makes repeats harmless.
    this.timer = setInterval(() => { const h = new Date().getHours(); if (h >= 8 && h < 20) void this.run().catch((e) => this.log.error(e)) }, 60 * 60 * 1000)
    setTimeout(() => { const h = new Date().getHours(); if (h >= 8 && h < 20) void this.run().catch((e) => this.log.error(e)) }, 30_000)
  }
  onModuleDestroy() { clearInterval(this.timer) }

  async run(schoolId?: string, now = new Date()) {
    const todayStr = now.toISOString().slice(0, 10)
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`)
    const soon = new Date(todayDate.getTime() + DUE_DAYS * 86_400_000)
    const base = { status: 'unpaid', waiverStatus: { not: 'requested' }, ...(schoolId ? { schoolId } : {}) }
    const [dueRows, lateRows] = await Promise.all([
      this.prisma.invoice.findMany({ where: { ...base, dueDate: { gte: todayDate, lte: soon } } }),
      this.prisma.invoice.findMany({ where: { ...base, dueDate: { lt: todayDate } } }),
    ])
    const ids = [...dueRows, ...lateRows].map((i) => i.id)
    const sent = ids.length ? await this.prisma.feeReminder.findMany({ where: { invoiceId: { in: ids } }, orderBy: { sentAt: 'desc' } }) : []
    const by = (id: string, kind: string) => sent.filter((r) => r.invoiceId === id && r.kind === kind)
    const day = (d: Date) => d.toISOString().slice(0, 10)
    let due = 0, overdue = 0

    for (const inv of dueRows) {
      if (by(inv.id, 'due').length) continue
      const daysLeft = Math.round((inv.dueDate.getTime() - todayDate.getTime()) / 86_400_000)
      await this.prisma.feeReminder.create({ data: { schoolId: inv.schoolId, invoiceId: inv.id, kind: 'due' } })
      await this.bus.emit('fee.due', { schoolId: inv.schoolId, invoiceId: inv.id, studentId: inv.studentId, title: inv.title, amount: inv.amount, dueDate: day(inv.dueDate), daysLeft })
      due++
    }
    for (const inv of lateRows) {
      const prev = by(inv.id, 'overdue')
      if (prev.length >= OVERDUE_MAX) continue
      if (prev[0] && now.getTime() - prev[0].sentAt.getTime() < OVERDUE_EVERY_DAYS * 86_400_000 - 3_600_000) continue
      const daysLate = Math.round((todayDate.getTime() - inv.dueDate.getTime()) / 86_400_000)
      await this.prisma.feeReminder.create({ data: { schoolId: inv.schoolId, invoiceId: inv.id, kind: 'overdue' } })
      await this.bus.emit('fee.overdue', { schoolId: inv.schoolId, invoiceId: inv.id, studentId: inv.studentId, title: inv.title, amount: inv.amount, dueDate: day(inv.dueDate), daysLate })
      overdue++
    }
    if (due || overdue) this.log.log(`Fee reminders sent: ${due} due soon, ${overdue} overdue`)
    return { due, overdue }
  }
}

@Controller('fees')
@UseGuards(AuthGuard, PermissionGuard)
export class FeesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus, private svc: FeesService, private reminders: FeeReminders) {}

  @Get('config')
  config() {
    return { razorpay: razorpayConfigured(), keyId: process.env.RAZORPAY_KEY_ID ?? null, webhook: !!process.env.RAZORPAY_WEBHOOK_SECRET }
  }

  private async decorate(rows: any[]) {
    const [students, classes] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, name: true } }),
      this.prisma.class.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true } }),
    ])
    const refunds = await this.prisma.refund.findMany({ where: { invoiceId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' } })
    const rf = new Map<string, (typeof refunds)[number]>()
    for (const x of [...refunds].reverse()) rf.set(x.invoiceId, x) // the newest refund wins
    const refundedTotal = new Map<string, number>()
    for (const x of refunds) if (x.status !== 'failed') refundedTotal.set(x.invoiceId, (refundedTotal.get(x.invoiceId) ?? 0) + x.amount)
    const s = new Map(students.map((x) => [x.id, x.name]))
    const c = new Map(classes.map((x) => [x.id, x.name]))
    return rows.map((r) => ({ ...r, refundedAmount: refundedTotal.get(r.id) ?? 0, refund: rf.get(r.id) ? { status: rf.get(r.id)!.status, method: rf.get(r.id)!.method, reason: rf.get(r.id)!.reason, amount: rf.get(r.id)!.amount, at: rf.get(r.id)!.createdAt } : null, dueDate: r.dueDate.toISOString().slice(0, 10), studentName: s.get(r.studentId) ?? '', className: c.get(r.classId) ?? '', overdue: isOverdue(r) }))
  }

  /** Student: own. Parent: linked children. Staff with school read: everything (filterable). */
  @Get('invoices')
  async list(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response, @Query('classId') classId?: string, @Query('studentId') studentId?: string, @Query('status') status?: string) {
    const staff = can(user, 'fees', 'read')
    const where: any = { schoolId: user.schoolId, ...(classId ? { classId } : {}), ...(status && status !== 'overdue' ? { status } : {}) }
    if (status === 'overdue') { where.status = 'unpaid'; where.dueDate = { lt: new Date(new Date().toISOString().slice(0, 10)) } }
    if (!staff) {
      const ids = user.role === 'student' ? [user.id] : user.linkedStudentIds ?? []
      if (!ids.length) { setTotal(res, 0); return [] }
      where.studentId = studentId ? (ids.includes(studentId) ? studentId : '__none__') : { in: ids }
    } else if (studentId) where.studentId = studentId
    setTotal(res, await this.prisma.invoice.count({ where }))
    const rows = await this.prisma.invoice.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: await listLimit(this.prisma, user.schoolId), include: { payments: { select: { method: true, paidAt: true, reference: true } } } })
    return this.decorate(rows)
  }

  /** Creates one invoice per student in a class (bulk). Students who already have this fee title are skipped. */
  @Post('invoices')
  @RequirePermission('fees', 'bulk_write')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoicesDto) {
    const cls = await this.prisma.class.findFirst({ where: { id: dto.classId, schoolId: user.schoolId, deletedAt: null } })
    if (!cls || !can(user, 'fees', 'bulk_write', { schoolId: cls.schoolId })) throw new ForbiddenException()
    const members = await this.prisma.classMember.findMany({ where: { classId: dto.classId, roleInClass: 'student' }, select: { userId: true } })
    const existing = await this.prisma.invoice.findMany({ where: { classId: dto.classId, title: dto.title }, select: { studentId: true } })
    const has = new Set(existing.map((e) => e.studentId))
    const todo = members.filter((m) => !has.has(m.userId))
    const bulkId = randomUUID()
    if (todo.length) {
      await this.prisma.invoice.createMany({ data: todo.map((m) => ({ schoolId: user.schoolId, studentId: m.userId, classId: dto.classId, title: dto.title.trim(), amount: dto.amount, dueDate: new Date(`${dto.dueDate}T00:00:00.000Z`), createdById: user.id })) })
    }
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'fees.invoices_created', resource: 'invoice', bulkId, meta: { classId: dto.classId, title: dto.title, created: todo.length, skipped: members.length - todo.length } })
    return { created: todo.length, skipped: members.length - todo.length }
  }

  /** Shared by single and bulk mark-paid so both go through the same checks. */
  private markPaid(user: AuthUser, id: string, method: string, reference: string | undefined, bulkId?: string, razorpayPaymentId?: string, viaOnline = false) {
    return this.svc.settle({ actorId: user.id, id, method, reference, bulkId, razorpayPaymentId, allow: viaOnline ? undefined : (inv) => can(user, 'fees', 'write', { schoolId: inv.schoolId }) })
  }

  @Post('bulk-pay')
  @RequirePermission('fees', 'bulk_write')
  async bulkPay(@CurrentUser() user: AuthUser, @Body() dto: BulkPayDto) {
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results = []
    for (const id of ids) results.push(await this.markPaid(user, id, dto.method, dto.reference, bulkId))
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'invoice', action: 'mark_paid', recordIds: ids, reason: dto.reference, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'fees.bulk_mark_paid', resource: 'invoice', bulkId, meta: { count: ids.length, succeeded: summary.succeeded, method: dto.method } })
    return { bulkId, ...summary, results }
  }

  @Post('invoices/:id/pay')
  @RequirePermission('fees', 'write')
  async pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { method: string; reference?: string }) {
    if (!METHODS.includes(dto.method)) throw new BadRequestException('Unknown payment method')
    const r = await this.markPaid(user, id, dto.method, dto.reference)
    if (!r.ok) throw new BadRequestException(r.error)
    return r
  }

  // ---- waivers ----

  @Post('invoices/:id/request-waiver')
  @RequirePermission('fees', 'write')
  async requestWaiver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WaiverRequestDto) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!inv) throw new NotFoundException()
    if (inv.status !== 'unpaid') throw new BadRequestException(`Invoice is already ${inv.status}`)
    if (inv.waiverStatus === 'requested') throw new BadRequestException('A waiver is already pending')
    await this.prisma.invoice.update({ where: { id }, data: { waiverStatus: 'requested', waiverReason: dto.reason, waiverNote: null } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'fee.waiver_requested', resource: 'invoice', resourceId: id })
    return { ok: true }
  }

  @Get('waivers')
  @RequirePermission('fees', 'approve')
  async waivers(@CurrentUser() user: AuthUser, @Query('status') status = 'requested') {
    return this.decorate(await this.prisma.invoice.findMany({ where: { schoolId: user.schoolId, waiverStatus: status }, orderBy: { createdAt: 'asc' }, take: 500 }))
  }

  @Post('waivers/bulk-approve')
  @RequirePermission('fees', 'bulk_approve')
  async bulkWaivers(@CurrentUser() user: AuthUser, @Body() dto: WaiverDecideDto) {
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const inv = await tx.invoice.findUnique({ where: { id } })
          if (!inv) throw new Error('Not found')
          if (!can(user, 'fees', 'approve', { schoolId: inv.schoolId })) throw new Error('Not permitted')
          if (inv.waiverStatus !== 'requested' || inv.status !== 'unpaid') throw new Error('No pending waiver on an unpaid invoice')
          const upd = await tx.invoice.updateMany({ where: { id, waiverStatus: 'requested', status: 'unpaid' }, data: dto.decision === 'approve' ? { waiverStatus: 'approved', status: 'waived', waiverNote: dto.reason, waiverDecidedById: user.id } : { waiverStatus: 'rejected', waiverNote: dto.reason, waiverDecidedById: user.id } })
          if (upd.count !== 1) throw new Error('Status changed')
          await this.audit.log(tx, { schoolId: inv.schoolId, actorId: user.id, action: dto.decision === 'approve' ? 'fee.waiver_approved' : 'fee.waiver_rejected', resource: 'invoice', resourceId: id, bulkId, meta: { reason: dto.reason } })
        })
        results.push({ id, ok: true })
      } catch (e) { results.push({ id, ok: false, error: (e as Error).message }) }
    }
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'invoice_waiver', action: dto.decision, recordIds: ids, reason: dto.reason, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: `fees.waiver_bulk_${dto.decision}`, resource: 'invoice', bulkId, meta: { count: ids.length, succeeded: summary.succeeded, reason: dto.reason } })
    return { bulkId, ...summary, results }
  }

  // ---- reminders and refunds ----

  /** Runs the reminder check now. The hourly job does the same automatically; nothing is sent twice. */
  @Post('reminders/run')
  @RequirePermission('fees', 'bulk_write')
  async runReminders(@CurrentUser() user: AuthUser) {
    const r = await this.reminders.run(user.schoolId)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'fees.reminders_run', resource: 'invoice', meta: r })
    return r
  }

  /**
   * Refund a paid invoice, in full or in part. Online payments go back through Razorpay; anything paid at the office is
   * recorded as handed back. Several partial refunds can follow one another until the whole payment has been returned;
   * the invoice becomes "refunded" only then. The student and parents are told each time.
   */
  @Post('invoices/:id/refund')
  @RequirePermission('fees', 'refund')
  async refund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RefundDto) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, schoolId: user.schoolId }, include: { payments: { orderBy: { paidAt: 'desc' }, take: 1 } } })
    if (!inv) throw new NotFoundException()
    if (inv.status !== 'paid') throw new BadRequestException(inv.status === 'refunded' ? 'This invoice is already refunded' : `Only a paid invoice can be refunded (this one is ${inv.status})`)
    const pay = inv.payments[0]
    if (!pay) throw new BadRequestException('There is no payment on this invoice to refund')
    const online = !!pay.razorpayPaymentId
    if (online && !razorpayConfigured()) throw new ServiceUnavailableException('Online payments are not set up, so this online payment cannot be refunded from here.')
    const reason = dto.reason.trim()

    // Reserve the amount first, so two refunds at once can never return more than was paid. Failed refunds do not count.
    let reserved: { id: string; amount: number; remaining: number }
    try {
      reserved = await this.prisma.$transaction(async (tx) => {
        const done = await tx.refund.aggregate({ where: { invoiceId: id, status: { not: 'failed' } }, _sum: { amount: true } })
        const remaining = pay.amount - (done._sum.amount ?? 0)
        if (remaining <= 0) throw new BadRequestException('This invoice is already fully refunded')
        const amount = dto.amount ?? remaining
        if (amount > remaining) throw new BadRequestException(`At most Rs ${(remaining / 100).toFixed(2)} can still be refunded on this invoice`)
        const row = await tx.refund.create({ data: { schoolId: inv.schoolId, invoiceId: id, paymentId: pay.id, amount, reason, method: online ? 'razorpay' : 'manual', status: 'pending', createdById: user.id } })
        return { id: row.id, amount, remaining }
      }, { isolationLevel: 'Serializable' })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2034') throw new ConflictException('Another refund on this invoice is in progress. Refresh and try again.')
      throw e
    }

    let razorpayRefundId: string | null = null
    let status = 'processed'
    if (online) {
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payments/${pay.razorpayPaymentId}/refund`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: razorpayAuth() },
          body: JSON.stringify({ amount: reserved.amount, notes: { invoiceId: inv.id, reason: reason.slice(0, 200) } }),
        })
        const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { description?: string } }
        if (!res.ok || !body.id) throw new BadGatewayException(`Razorpay could not refund this: ${body.error?.description ?? res.status}`)
        razorpayRefundId = body.id
        status = body.status === 'processed' ? 'processed' : 'pending'
      } catch (e) {
        await this.prisma.refund.delete({ where: { id: reserved.id } }) // nothing was refunded, so release the reservation
        throw e instanceof BadGatewayException ? e : new BadGatewayException('Razorpay could not be reached, so nothing was refunded.')
      }
    }

    const full = reserved.amount === reserved.remaining
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: reserved.id }, data: { razorpayRefundId, status } })
      if (full) await tx.invoice.updateMany({ where: { id, status: 'paid' }, data: { status: 'refunded' } })
      await this.audit.log(tx, { schoolId: inv.schoolId, actorId: user.id, action: 'fee.refunded', resource: 'invoice', resourceId: id, meta: { amount: reserved.amount, full, method: online ? 'razorpay' : 'manual', reason } })
    })
    await this.bus.emit('fee.refunded', { schoolId: inv.schoolId, invoiceId: id, studentId: inv.studentId, title: inv.title, amount: reserved.amount, actorId: user.id })
    return { id, refunded: full, partial: !full, amount: reserved.amount, remaining: reserved.remaining - reserved.amount, method: online ? 'razorpay' : 'manual', status }
  }

  // ---- online payment (Razorpay) ----

  private async ownInvoice(user: AuthUser, id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!inv || !can(user, 'fees', 'pay', { studentId: inv.studentId })) throw new ForbiddenException()
    if (inv.status !== 'unpaid') throw new BadRequestException(`Invoice is already ${inv.status}`)
    return inv
  }

  /** Step 1: create a Razorpay order for an invoice the parent may pay. */
  @Post('invoices/:id/online-order')
  async onlineOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!razorpayConfigured()) throw new ServiceUnavailableException('Online payments are not set up yet. Ask the school office.')
    const inv = await this.ownInvoice(user, id)
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}` },
      body: JSON.stringify({ amount: inv.amount, currency: 'INR', receipt: inv.id.slice(-30), notes: { invoiceId: inv.id } }),
    })
    if (!res.ok) throw new ServiceUnavailableException(`Payment provider error (${res.status})`)
    const order = (await res.json()) as { id: string }
    await this.prisma.invoice.update({ where: { id }, data: { razorpayOrderId: order.id } })
    return { orderId: order.id, amount: inv.amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, title: inv.title }
  }

  /** Step 2: after checkout, verify the signature server-side and only then mark the invoice paid. */
  @Post('invoices/:id/online-verify')
  async onlineVerify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VerifyDto) {
    if (!razorpayConfigured()) throw new ServiceUnavailableException('Online payments are not set up yet.')
    const inv = await this.ownInvoice(user, id)
    if (!inv.razorpayOrderId || inv.razorpayOrderId !== dto.razorpay_order_id) throw new BadRequestException('Order does not match this invoice')
    if (!verifyRazorpaySignature(dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature, process.env.RAZORPAY_KEY_SECRET!)) throw new BadRequestException('Payment signature is invalid')
    const r = await this.markPaid(user, id, 'online', dto.razorpay_payment_id, undefined, dto.razorpay_payment_id, true)
    if (!r.ok) throw new BadRequestException(r.error)
    return r
  }
}

/**
 * Razorpay tells us about payments itself, so an invoice is still marked paid when the parent closes the browser before
 * checkout returns. It is public (Razorpay has no login) and trusted only through the signature on the raw body.
 */
@Controller('fees/razorpay')
export class FeesWebhookController {
  private log = new Logger('RazorpayWebhook')
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: FeesService) {}

  @Post('webhook')
  @HttpCode(200)
  async hook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string, @Body() body: any) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!secret) throw new ServiceUnavailableException('Webhook is not set up')
    if (!req.rawBody || !signature || !verifyWebhookSignature(req.rawBody, signature, secret)) throw new ForbiddenException('Bad signature')

    const event: string = body?.event
    if (event === 'payment.captured' || event === 'order.paid') return this.paid(body)
    if (event === 'refund.processed' || event === 'refund.failed') return this.refunded(body, event === 'refund.processed' ? 'processed' : 'failed')
    return { ok: true, ignored: event }
  }

  private async paid(body: any) {
    const pay = body?.payload?.payment?.entity as { id?: string; order_id?: string; amount?: number; notes?: { invoiceId?: string } } | undefined
    if (!pay?.id || !pay.order_id) return { ok: true, ignored: 'no payment' }
    const inv = (await this.prisma.invoice.findFirst({ where: { razorpayOrderId: pay.order_id } })) ?? (pay.notes?.invoiceId ? await this.prisma.invoice.findUnique({ where: { id: pay.notes.invoiceId } }) : null)
    if (!inv) { this.log.warn(`Payment ${pay.id} matches no invoice`); return { ok: true, ignored: 'unknown order' } }

    const flag = (action: string, meta: object) => this.audit.log(this.prisma, { schoolId: inv.schoolId, actorId: 'razorpay', action, resource: 'invoice', resourceId: inv.id, meta })
    if (pay.amount !== inv.amount) { await flag('fee.payment_mismatch', { paymentId: pay.id, paid: pay.amount, expected: inv.amount }); return { ok: true, flagged: 'amount mismatch' } }
    if (inv.status === 'unpaid') {
      const r = await this.svc.settle({ actorId: 'razorpay', id: inv.id, method: 'online', reference: pay.id, razorpayPaymentId: pay.id })
      // Checkout verification may have won the race a moment ago. That is fine.
      if (!r.ok && !/Already|Status changed/.test(r.error)) throw new ServiceUnavailableException(r.error) // 5xx so Razorpay retries
      return { ok: true, settled: r.ok }
    }
    // Already settled: fine if it is this very payment, otherwise money was taken twice and needs a human.
    const same = await this.prisma.payment.findFirst({ where: { razorpayPaymentId: pay.id } })
    if (!same) await flag('fee.duplicate_payment', { paymentId: pay.id, invoiceStatus: inv.status })
    return { ok: true, alreadySettled: true }
  }

  private async refunded(body: any, status: 'processed' | 'failed') {
    const r = body?.payload?.refund?.entity as { id?: string } | undefined
    if (!r?.id) return { ok: true, ignored: 'no refund' }
    const upd = await this.prisma.refund.updateMany({ where: { razorpayRefundId: r.id }, data: { status } })
    return { ok: true, updated: upd.count }
  }
}

@Module({ controllers: [FeesController, FeesWebhookController], providers: [FeesService, FeeReminders] })
export class FeesModule {}
