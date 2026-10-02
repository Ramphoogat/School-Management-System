import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { roleCan } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { Channel, CHANNELS, EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'
import { attendanceStats } from '../attendance/leave'
import { ATTENDANCE_ALERT_COOLDOWN_DAYS, ATTENDANCE_MIN_DAYS, ATTENDANCE_THRESHOLD, ATTENDANCE_WINDOW_DAYS } from '../attendance/threshold'
import { emailConfigured, NotConfiguredError, sendEmail, sendWhatsApp, whatsappConfigured } from './senders'
import { BODY_MAX, SUBJECT_MAX, TEMPLATES, fill, templateFor, unknownPlaceholders } from './templates'
import { quietUntil, validTimezone } from './quiet-hours'

const MAX_ATTEMPTS = 3
/** A fee this many days overdue is sent with the urgent wording. */
export const URGENT_OVERDUE_DAYS = 30
const backoffMs = (attempt: number) => 30_000 * 4 ** (attempt - 1) // 30s, 2m, 8m

/**
 * Notification module: subscribes to events, decides who gets what on which channel (sender's
 * choice filtered by each recipient's preferences), queues rows, and a background worker delivers
 * them with retry/backoff. A failed WhatsApp message falls back to email.
 * The queue is a DB table polled in-process; swap for BullMQ/Redis when scaling out.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Notifications')
  private timer?: NodeJS.Timeout
  private running = false

  constructor(private prisma: PrismaService, private bus: EventBus) {}

  onModuleInit() {
    this.bus.on('attendance.marked', (e) => this.onAttendance(e))
    this.bus.on('announcement.posted', (e) => this.onAnnouncement(e))
    this.bus.on('homework.assigned', (e) => this.onHomework(e))
    this.bus.on('leave.decided', (e) => this.onLeaveDecided(e))
    this.bus.on('leave.message', (e) => this.onLeaveMessage(e))
    this.bus.on('dm.received', (e) => this.onDirectMessage(e))
    this.bus.on('dm.reported', (e) => this.onDmReported(e))
    this.bus.on('dm.report_reviewed', (e) => this.onDmReportReviewed(e))
    this.bus.on('student.admitted', (e) => this.onAdmitted(e))
    this.bus.on('fee.paid', (e) => this.onFeePaid(e))
    this.bus.on('fee.due', (e) => this.onFeeDue(e))
    this.bus.on('fee.overdue', (e) => this.onFeeOverdue(e))
    this.bus.on('fee.refunded', (e) => this.onFeeRefunded(e))
    this.bus.on('results.submitted', (e) => this.onResultsSubmitted(e))
    this.bus.on('results.approved', (e) => this.onResultsApproved(e))
    // Tests turn the background worker off and drive delivery by hand for deterministic results.
    if (process.env.NOTIFICATIONS_WORKER !== 'off') this.timer = setInterval(() => void this.processQueue(), 5000)
  }
  onModuleDestroy() {
    clearInterval(this.timer)
  }

  /**
   * Apply each recipient's preferences and WhatsApp consent/phone, then queue rows. Email and WhatsApp for someone in their
   * quiet hours are held until the window ends (in-app alerts are always immediate). Urgent notifications ignore quiet hours.
   */
  async enqueue(schoolId: string, userIds: string[], event: string, channels: Channel[], subject: string, body: string, ref?: string, urgent = false) {
    const ids = [...new Set(userIds)]
    if (!ids.length || !channels.length) return
    const [users, prefs, consents, quiet] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true } }),
      this.prisma.notificationPreference.findMany({ where: { userId: { in: ids }, enabled: false } }),
      this.prisma.whatsAppConsent.findMany({ where: { userId: { in: ids }, optedIn: true } }),
      urgent ? Promise.resolve([]) : this.prisma.quietHours.findMany({ where: { userId: { in: ids }, enabled: true } }),
    ])
    const off = new Set(prefs.map((p) => `${p.userId}:${p.channel}`))
    const consent = new Set(consents.map((c) => c.userId))
    const quietBy = new Map(quiet.map((q) => [q.userId, q]))
    const now = new Date()
    const shownSubject = urgent && !/^urgent/i.test(subject) ? `Urgent: ${subject}` : subject
    const data: { schoolId: string; userId: string; event: string; channel: string; subject: string; body: string; ref?: string; urgent: boolean; nextAttemptAt: Date; status?: string; sentAt?: Date }[] = []
    for (const u of users) {
      for (const channel of channels) {
        if (off.has(`${u.id}:${channel}`)) continue
        if (channel === 'whatsapp' && (!u.phone || !consent.has(u.id))) continue // opt-in required
        const q = quietBy.get(u.id)
        const until = channel !== 'in_app' && q ? quietUntil(now, q) : null
        // In-app messages are delivered the moment they are stored.
        data.push({ schoolId, userId: u.id, event, channel, subject: shownSubject, body, ref, urgent, nextAttemptAt: until ?? now, ...(channel === 'in_app' ? { status: 'delivered', sentAt: now } : {}) })
      }
    }
    if (data.length) await this.prisma.notification.createMany({ data })
  }

  async processQueue() {
    if (this.running) return
    this.running = true
    try {
      const due = await this.prisma.notification.findMany({
        where: { status: 'queued', channel: { in: ['email', 'whatsapp'] }, nextAttemptAt: { lte: new Date() } },
        orderBy: [{ urgent: 'desc' }, { createdAt: 'asc' }], // urgent first
        take: 25,
      })
      for (const n of due) await this.deliver(n)
    } catch (e) {
      this.log.error((e as Error).message)
    } finally {
      this.running = false
    }
  }

  private async deliver(n: { id: string; userId: string; schoolId: string; event: string; channel: string; subject: string; body: string; attempts: number }) {
    const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, phone: true } })
    try {
      if (n.channel === 'email') {
        if (!user?.email) throw new NotConfiguredError('Recipient has no email')
        await sendEmail(user.email, n.subject, n.body)
      } else {
        if (!user?.phone) throw new NotConfiguredError('Recipient has no phone')
        await sendWhatsApp(user.phone, `${n.subject}: ${n.body}`)
      }
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'sent', sentAt: new Date(), attempts: n.attempts + 1, error: null } })
    } catch (e) {
      const attempts = n.attempts + 1
      const error = (e as Error).message
      // Not-configured errors will not fix themselves; other errors are retried with backoff.
      const permanent = e instanceof NotConfiguredError || attempts >= MAX_ATTEMPTS
      await this.prisma.notification.update({
        where: { id: n.id },
        data: permanent
          ? { status: 'failed', attempts, error }
          : { attempts, error, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
      })
      if (permanent && n.channel === 'whatsapp') await this.fallbackToEmail(n)
    }
  }

  private async fallbackToEmail(n: { userId: string; schoolId: string; event: string; subject: string; body: string }) {
    const off = await this.prisma.notificationPreference.findFirst({ where: { userId: n.userId, channel: 'email', enabled: false } })
    const already = await this.prisma.notification.findFirst({ where: { userId: n.userId, event: n.event, channel: 'email', subject: n.subject, body: n.body } })
    if (off || already) return
    await this.prisma.notification.create({ data: { schoolId: n.schoolId, userId: n.userId, event: n.event, channel: 'email', nextAttemptAt: new Date(), subject: n.subject, body: `${n.body}\n\n(Sent by email because WhatsApp delivery failed.)` } })
  }

  // ---- event handlers ----

  /**
   * Turns an event into notifications using the school's template (or the default). If the event can be urgent and it is,
   * the urgent wording is used, and the notification skips quiet hours and goes first.
   */
  private async notify(schoolId: string, userIds: string[], event: string, channels: Channel[], vars: Record<string, string | number>, opts: { urgent?: boolean; ref?: string } = {}) {
    const def = templateFor(event)
    if (!def) throw new Error(`No template for ${event}`)
    const variant: 'normal' | 'urgent' = opts.urgent && def.urgent ? 'urgent' : 'normal'
    const custom = await this.prisma.notificationTemplate.findUnique({ where: { schoolId_event_variant: { schoolId, event, variant } } })
    const text = custom ?? def[variant]!
    await this.enqueue(schoolId, userIds, event, channels, fill(text.subject, vars), fill(text.body, vars), opts.ref, variant === 'urgent')
  }

  /** The student and their approved parents, who all need to hear about a school matter. */
  private async withParents(studentId: string) {
    const links = await this.prisma.parentStudentLink.findMany({ where: { studentId, status: 'approved' }, select: { parentId: true } })
    return [studentId, ...links.map((l) => l.parentId)]
  }

  private rupees = (paise: number) => (paise / 100).toFixed(2)

  /** One in-app alert per sender until it is read, so a busy conversation does not bury the inbox. */
  /**
   * The in-app alert stays as it was (one open alert per sender). On top of that the message is copied by email and,
   * with consent, WhatsApp, but only when the person is not in the app right now (they would see it live), and at most
   * once per conversation every 10 minutes so a long chat never floods an inbox. Their notification settings still apply.
   */
  private async onDirectMessage(e: { schoolId: string; conversationId: string; recipientId: string; senderName: string; body?: string; attachments?: number; recipientOnline?: boolean }) {
    const subject = `New message from ${e.senderName}`
    const open = await this.prisma.notification.findFirst({ where: { userId: e.recipientId, event: 'dm.received', channel: 'in_app', subject, readAt: null } })
    if (!open) await this.enqueue(e.schoolId, [e.recipientId], 'dm.received', ['in_app'], subject, 'Open Messages to read and reply.')

    if (e.recipientOnline) return
    const ref = `dm:${e.conversationId}`
    const recent = await this.prisma.notification.findFirst({ where: { userId: e.recipientId, ref, channel: { in: ['email', 'whatsapp'] }, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } })
    if (recent) return
    const text = (e.body ?? '').trim().slice(0, 300)
    const files = e.attachments ? `${text ? '\n' : ''}[${e.attachments} attachment${e.attachments === 1 ? '' : 's'}]` : ''
    await this.enqueue(e.schoolId, [e.recipientId], 'dm.received', ['email', 'whatsapp'], subject, `${e.senderName} wrote:\n${text}${files}\n\nOpen the school app to read and reply.`, ref)
  }

  /** Reported conversations go to the person who may review them: the principal, or the admins when the principal is involved. */
  private async onDmReported(e: { schoolId: string; reporterId: string; participantIds: string[] }) {
    const people = await this.prisma.user.findMany({ where: { id: { in: e.participantIds } }, select: { role: true } })
    const role = people.some((p) => p.role === 'principal') ? 'admin' : 'principal'
    const reviewers = await this.prisma.user.findMany({ where: { schoolId: e.schoolId, active: true, role }, select: { id: true } })
    await this.enqueue(e.schoolId, reviewers.map((r) => r.id), 'dm.reported', ['in_app', 'email'], 'A conversation was reported', 'Someone reported a message conversation. Open Message reports to review it.')
  }

  private async onDmReportReviewed(e: { schoolId: string; reporterId: string; status: 'reviewed' | 'dismissed'; note?: string | null }) {
    const word = e.status === 'reviewed' ? 'reviewed by the school' : 'looked at by the school. No action was needed'
    await this.enqueue(e.schoolId, [e.reporterId], 'dm.report_reviewed', ['in_app'], 'Your report was handled', `Your report was ${word}.${e.note ? ` Note: ${e.note}` : ''}`)
  }

  private async onLeaveDecided(e: { schoolId: string; requesterId: string; subjectUserId: string; decision: 'approve' | 'reject'; fromDate: string; toDate: string }) {
    const subject = await this.prisma.user.findUnique({ where: { id: e.subjectUserId }, select: { name: true } })
    const dates = e.fromDate === e.toDate ? e.fromDate : `${e.fromDate} to ${e.toDate}`
    await this.notify(e.schoolId, [e.requesterId], e.decision === 'approve' ? 'leave.approved' : 'leave.rejected', ['whatsapp', 'email', 'in_app'], { student: subject?.name ?? 'you', dates })
  }

  /** A new message on a leave request goes to everyone else in the conversation: the requester side, the deciding approver, earlier writers, or, if nobody has replied yet, the principal and admins. */
  private async onLeaveMessage(e: { schoolId: string; leaveId: string; authorId: string; authorName: string; requesterId: string; subjectUserId: string; decidedById: string | null }) {
    const [links, writers] = await Promise.all([
      this.prisma.parentStudentLink.findMany({ where: { studentId: e.subjectUserId, status: 'approved' }, select: { parentId: true } }),
      this.prisma.leaveMessage.findMany({ where: { leaveId: e.leaveId }, select: { authorId: true }, distinct: ['authorId'] }),
    ])
    const people = new Set([e.requesterId, e.subjectUserId, ...links.map((l) => l.parentId), ...writers.map((w) => w.authorId), ...(e.decidedById ? [e.decidedById] : [])])
    const approvers = await this.prisma.user.findMany({ where: { schoolId: e.schoolId, active: true, role: { in: ['principal', 'admin'] } }, select: { id: true } })
    if (![...people].some((id) => approvers.some((a) => a.id === id))) approvers.forEach((a) => people.add(a.id))
    people.delete(e.authorId)
    await this.enqueue(e.schoolId, [...people], 'leave.message', ['in_app'], 'New message on a leave request', `${e.authorName} wrote a message on a leave request.`)
  }

  private async onAdmitted(e: { schoolId: string; studentId: string; parentId: string; studentName: string }) {
    await this.notify(e.schoolId, [e.parentId, e.studentId], 'student.admitted', ['email', 'whatsapp', 'in_app'], { student: e.studentName })
  }

  private async onFeeDue(e: { schoolId: string; studentId: string; title: string; amount: number; dueDate: string; daysLeft: number }) {
    const when = e.daysLeft <= 0 ? 'today' : e.daysLeft === 1 ? 'tomorrow' : `in ${e.daysLeft} days (${e.dueDate})`
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'fee.due', ['email', 'whatsapp', 'in_app'], { title: e.title, amount: this.rupees(e.amount), dueDate: e.dueDate, when })
  }

  private async onFeeOverdue(e: { schoolId: string; studentId: string; title: string; amount: number; dueDate: string; daysLate: number }) {
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'fee.overdue', ['email', 'whatsapp', 'in_app'], { title: e.title, amount: this.rupees(e.amount), dueDate: e.dueDate, daysLate: e.daysLate }, { urgent: e.daysLate >= URGENT_OVERDUE_DAYS })
  }

  private async onFeeRefunded(e: { schoolId: string; studentId: string; title: string; amount: number }) {
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'fee.refunded', ['email', 'whatsapp', 'in_app'], { title: e.title, amount: this.rupees(e.amount) })
  }

  private async onFeePaid(e: { schoolId: string; studentId: string; title: string; amount: number }) {
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'fee.paid', ['email', 'whatsapp', 'in_app'], { title: e.title, amount: this.rupees(e.amount) })
  }

  private async onResultsSubmitted(e: { schoolId: string; name: string }) {
    const approvers = await this.prisma.user.findMany({ where: { schoolId: e.schoolId, role: 'principal', active: true }, select: { id: true } })
    await this.notify(e.schoolId, approvers.map((u) => u.id), 'results.submitted', ['in_app'], { exam: e.name })
  }

  private async onResultsApproved(e: { schoolId: string; studentId: string; examName: string; subject: string; score: number | null; maxMarks: number }) {
    const score = e.score === null ? 'absent' : `${e.score}/${e.maxMarks}`
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'results.approved', ['email', 'whatsapp', 'in_app'], { exam: e.examName, subject: e.subject, score })
  }

  private async onAttendance(e: { schoolId: string; studentId: string; date: string; status: string }) {
    if (e.status !== 'absent') return
    await this.checkLowAttendance(e)
    const [student, links] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: e.studentId }, select: { name: true } }),
      this.prisma.parentStudentLink.findMany({ where: { studentId: e.studentId, status: 'approved' }, select: { parentId: true } }),
    ])
    await this.notify(e.schoolId, links.map((l) => l.parentId), 'attendance.marked', ['whatsapp', 'in_app'], { student: student?.name ?? 'Your child', date: e.date })
  }

  /**
   * An absence can push a student under the attendance threshold. Alert the student and their parents once,
   * then stay quiet for a cooldown so every further absence does not repeat it.
   */
  private async checkLowAttendance(e: { schoolId: string; studentId: string }) {
    const since = new Date(Date.now() - ATTENDANCE_WINDOW_DAYS * 86_400_000)
    const rows = await this.prisma.attendance.findMany({ where: { studentId: e.studentId, date: { gte: since } }, select: { status: true } })
    const stats = attendanceStats(rows) // approved leave days are not held against the student
    if (stats.days < ATTENDANCE_MIN_DAYS || stats.percent === null) return
    const percent = stats.percent
    if (percent >= ATTENDANCE_THRESHOLD) return
    const student = await this.prisma.user.findUnique({ where: { id: e.studentId }, select: { name: true } })
    // Keyed by student rather than by wording, so the school can change the message without breaking the cooldown.
    const ref = `attendance.low:${e.studentId}`
    const recent = await this.prisma.notification.findFirst({ where: { schoolId: e.schoolId, event: 'attendance.low', ref, createdAt: { gte: new Date(Date.now() - ATTENDANCE_ALERT_COOLDOWN_DAYS * 86_400_000) } } })
    if (recent) return
    await this.notify(e.schoolId, await this.withParents(e.studentId), 'attendance.low', ['whatsapp', 'email', 'in_app'], { student: student?.name ?? 'your child', percent, days: ATTENDANCE_WINDOW_DAYS, threshold: ATTENDANCE_THRESHOLD }, { ref })
  }

  private async classAudience(schoolId: string, classId: string | null) {
    if (!classId) return (await this.prisma.user.findMany({ where: { schoolId, active: true }, select: { id: true } })).map((u) => u.id)
    const members = await this.prisma.classMember.findMany({ where: { classId }, select: { userId: true } })
    const links = await this.prisma.parentStudentLink.findMany({ where: { studentId: { in: members.map((m) => m.userId) }, status: 'approved' }, select: { parentId: true } })
    return [...members.map((m) => m.userId), ...links.map((l) => l.parentId)]
  }

  private async onAnnouncement(e: { schoolId: string; classId: string | null; title: string; body: string; urgent: boolean; channels: Channel[]; actorId: string }) {
    const ids = (await this.classAudience(e.schoolId, e.classId)).filter((id) => id !== e.actorId)
    await this.notify(e.schoolId, ids, 'announcement.posted', e.channels, { title: e.title, body: e.body }, { urgent: e.urgent })
  }

  private async onHomework(e: { schoolId: string; classId: string; title: string; dueDate: string; channels: Channel[]; actorId: string }) {
    const ids = (await this.classAudience(e.schoolId, e.classId)).filter((id) => id !== e.actorId)
    await this.notify(e.schoolId, ids, 'homework.assigned', e.channels, { title: e.title, dueDate: e.dueDate })
  }
}

class PrefDto {
  @IsIn(CHANNELS) channel: Channel
  @IsBoolean() enabled: boolean
}
class ProfileDto {
  @IsOptional() @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'Enter a valid phone number' }) phone?: string
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean
}
class QuietDto {
  @IsBoolean() enabled: boolean
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a time like 22:00' }) start: string
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use a time like 07:00' }) end: string
  @IsString() @MaxLength(60) timezone: string
}
class TemplateDto {
  @IsString() @MinLength(1) @MaxLength(SUBJECT_MAX) subject: string
  @IsString() @MinLength(1) @MaxLength(BODY_MAX) body: string
}

const VARIANTS = ['normal', 'urgent'] as const

@Controller('notifications')
@UseGuards(AuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const take = Math.min(500, Math.max(1, Number(limit) || 50))
    return this.prisma.notification.findMany({ where: { userId: user.id, channel: 'in_app' }, orderBy: { createdAt: 'desc' }, take })
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: user.id, channel: 'in_app', readAt: null }, data: { readAt: new Date() } })
    return { ok: true, count: r.count }
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } })
    return { ok: true }
  }

  /** Channels the platform can actually deliver on, so the UI can say so. */
  @Get('channels')
  channels() {
    return { email: emailConfigured(), whatsapp: whatsappConfigured(), in_app: true }
  }

  @Get('preferences')
  async prefs(@CurrentUser() user: AuthUser) {
    const [rows, consent, u] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId: user.id } }),
      this.prisma.whatsAppConsent.findUnique({ where: { userId: user.id } }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } }),
    ])
    const m = new Map(rows.map((r) => [r.channel, r.enabled]))
    return {
      channels: Object.fromEntries(CHANNELS.map((c) => [c, m.get(c) ?? true])),
      phone: u?.phone ?? '',
      whatsappOptIn: consent?.optedIn ?? false,
    }
  }

  @Put('preferences')
  async setPref(@CurrentUser() user: AuthUser, @Body() dto: PrefDto) {
    await this.prisma.notificationPreference.upsert({
      where: { userId_channel: { userId: user.id, channel: dto.channel } },
      update: { enabled: dto.enabled },
      create: { userId: user.id, channel: dto.channel, enabled: dto.enabled },
    })
    return { ok: true }
  }

  /** Phone number and WhatsApp opt-in (consent is stored with a timestamp). */
  @Put('profile')
  async profile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    if (dto.phone !== undefined) await this.prisma.user.update({ where: { id: user.id }, data: { phone: dto.phone.trim() || null } })
    if (dto.whatsappOptIn !== undefined) {
      await this.prisma.whatsAppConsent.upsert({ where: { userId: user.id }, update: { optedIn: dto.whatsappOptIn }, create: { userId: user.id, optedIn: dto.whatsappOptIn } })
    }
    return { ok: true }
  }

  // ---- quiet hours (each person's own) ----

  @Get('quiet-hours')
  async quiet(@CurrentUser() user: AuthUser) {
    const q = await this.prisma.quietHours.findUnique({ where: { userId: user.id } })
    return q ? { enabled: q.enabled, start: q.start, end: q.end, timezone: q.timezone } : { enabled: false, start: '22:00', end: '07:00', timezone: '' }
  }

  @Put('quiet-hours')
  async setQuiet(@CurrentUser() user: AuthUser, @Body() dto: QuietDto) {
    if (!validTimezone(dto.timezone)) throw new BadRequestException('Unknown timezone')
    if (dto.start === dto.end) throw new BadRequestException('Start and end must be different times')
    await this.prisma.quietHours.upsert({ where: { userId: user.id }, update: dto, create: { userId: user.id, ...dto } })
    return { ok: true }
  }

  // ---- message templates (admin) ----

  private manageOnly(user: AuthUser) {
    if (!roleCan(user.role, 'notifications', 'manage')) throw new ForbiddenException()
  }

  /** Every notification the school sends, with its wording, the placeholders it allows, and whether the admin changed it. */
  @Get('templates')
  async templates(@CurrentUser() user: AuthUser) {
    this.manageOnly(user)
    const custom = await this.prisma.notificationTemplate.findMany({ where: { schoolId: user.schoolId } })
    const has = (event: string, variant: string) => custom.find((c) => c.event === event && c.variant === variant)
    const shape = (event: string, variant: 'normal' | 'urgent', d: { subject: string; body: string }) => {
      const c = has(event, variant)
      return { subject: c?.subject ?? d.subject, body: c?.body ?? d.body, custom: !!c, default: d }
    }
    return TEMPLATES.map((t) => ({
      event: t.event, label: t.label, audience: t.audience, vars: t.vars, urgentWhen: t.urgentWhen ?? null,
      normal: shape(t.event, 'normal', t.normal),
      urgent: t.urgent ? shape(t.event, 'urgent', t.urgent) : null,
    }))
  }

  private def(event: string, variant: string) {
    const d = templateFor(event)
    if (!d || !(VARIANTS as readonly string[]).includes(variant) || (variant === 'urgent' && !d.urgent)) throw new NotFoundException('No such template')
    return d
  }

  @Put('templates/:event/:variant')
  async setTemplate(@CurrentUser() user: AuthUser, @Param('event') event: string, @Param('variant') variant: string, @Body() dto: TemplateDto) {
    this.manageOnly(user)
    const d = this.def(event, variant)
    const subject = dto.subject.trim(), body = dto.body.trim()
    if (!subject || !body) throw new BadRequestException('Both the subject and the message are needed')
    const bad = [...unknownPlaceholders(d, subject), ...unknownPlaceholders(d, body)]
    if (bad.length) throw new BadRequestException(`These placeholders are not available here: ${[...new Set(bad)].map((b) => `{${b}}`).join(', ')}. You can use: ${d.vars.map((x) => `{${x.name}}`).join(', ')}`)
    await this.prisma.notificationTemplate.upsert({
      where: { schoolId_event_variant: { schoolId: user.schoolId, event, variant } },
      update: { subject, body, updatedById: user.id },
      create: { schoolId: user.schoolId, event, variant, subject, body, updatedById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'notification.template_updated', resource: 'notification_template', meta: { event, variant } })
    return { ok: true }
  }

  @Delete('templates/:event/:variant')
  async resetTemplate(@CurrentUser() user: AuthUser, @Param('event') event: string, @Param('variant') variant: string) {
    this.manageOnly(user)
    this.def(event, variant)
    await this.prisma.notificationTemplate.deleteMany({ where: { schoolId: user.schoolId, event, variant } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'notification.template_reset', resource: 'notification_template', meta: { event, variant } })
    return { ok: true }
  }

  /** Delivery log for admins. */
  @Get('log')
  async deliveryLog(@CurrentUser() user: AuthUser) {
    this.manageOnly(user)
    const rows = await this.prisma.notification.findMany({ where: { schoolId: user.schoolId, channel: { in: ['email', 'whatsapp'] } }, orderBy: { createdAt: 'desc' }, take: 200 })
    const us = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } })
    const m = new Map(us.map((u) => [u.id, u.name]))
    const now = Date.now()
    return rows.map((r) => ({
      id: r.id, to: m.get(r.userId) ?? 'unknown', channel: r.channel, event: r.event, subject: r.subject, status: r.status, attempts: r.attempts, error: r.error, createdAt: r.createdAt,
      urgent: r.urgent,
      // Held back for the recipient's quiet hours: still queued and not due yet.
      scheduledFor: r.status === 'queued' && r.nextAttemptAt.getTime() > now + 60_000 ? r.nextAttemptAt : null,
    }))
  }
}

@Module({ providers: [NotificationsService], controllers: [NotificationsController] })
export class NotificationsModule {}
