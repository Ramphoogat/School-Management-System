import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { randomUUID } from 'node:crypto'
import { can, roleCan } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { listLimit } from '../common/total'
import { EventBus } from '../events/events.module'
import { applyApprovedLeave } from '../attendance/leave'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const day = (d: Date) => d.toISOString().slice(0, 10)

class RequestLeaveDto {
  @Matches(DATE) fromDate: string
  @Matches(DATE) toDate: string
  @IsString() @MinLength(3) reason: string
  /** Parents must say which child the leave is for. */
  @IsOptional() @IsString() studentId?: string
}
class MessageDto {
  @IsString() @MinLength(1) @MaxLength(2000) body: string
}
class BulkDecideDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject'
  @IsOptional() @IsString() reason?: string
}

@Controller('leave')
@UseGuards(AuthGuard, PermissionGuard)
export class LeaveController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus) {}

  private async decorate(rows: any[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.requesterId, r.subjectUserId]))]
    const us = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } })
    const m = new Map(us.map((u) => [u.id, u]))
    return rows.map((r) => ({ ...r, fromDate: day(r.fromDate), toDate: day(r.toDate), subjectName: m.get(r.subjectUserId)?.name ?? '', subjectRole: m.get(r.subjectUserId)?.role, requesterName: m.get(r.requesterId)?.name ?? '' }))
  }

  @Post()
  async request(@CurrentUser() user: AuthUser, @Body() dto: RequestLeaveDto) {
    if (dto.toDate < dto.fromDate) throw new BadRequestException('End date must be on or after the start date')
    if (user.role === 'parent' && !dto.studentId) throw new BadRequestException('Choose which child the leave is for')
    const subject = dto.studentId ?? user.id
    // Student/teacher/clerk: own leave. Parent: only a linked child's.
    const allowed = can(user, 'leave', 'request', { studentId: subject }) // own for self, own_child for a linked child
    if (!allowed) throw new ForbiddenException()
    const l = await this.prisma.leaveRequest.create({
      data: { schoolId: user.schoolId, requesterId: user.id, subjectUserId: subject, fromDate: new Date(`${dto.fromDate}T00:00:00.000Z`), toDate: new Date(`${dto.toDate}T00:00:00.000Z`), reason: dto.reason.trim() },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'leave.requested', resource: 'leave', resourceId: l.id })
    return (await this.decorate([l]))[0]
  }

  /** Approvers and admin see the school's requests; everyone else sees requests they made or that are for their children. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const school = roleCan(user.role, 'leave', 'approve') || roleCan(user.role, 'leave', 'read')
    const where: any = { schoolId: user.schoolId, ...(status ? { status } : {}) }
    if (!school) where.OR = [{ requesterId: user.id }, { subjectUserId: user.id }, { subjectUserId: { in: user.linkedStudentIds ?? [] } }]
    return this.decorate(await this.prisma.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: await listLimit(this.prisma, user.schoolId) }))
  }

  /** Same visibility as the list: approvers and readers see the school's, everyone else only requests they made or that concern them or their children. */
  private async load(user: AuthUser, id: string) {
    const l = await this.prisma.leaveRequest.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!l) throw new NotFoundException()
    const school = roleCan(user.role, 'leave', 'approve') || roleCan(user.role, 'leave', 'read')
    const mine = l.requesterId === user.id || l.subjectUserId === user.id || (user.linkedStudentIds ?? []).includes(l.subjectUserId)
    if (!school && !mine) throw new NotFoundException()
    return l
  }

  private async thread(leaveId: string) {
    const msgs = await this.prisma.leaveMessage.findMany({ where: { leaveId }, orderBy: { createdAt: 'asc' } })
    const us = await this.prisma.user.findMany({ where: { id: { in: [...new Set(msgs.map((m) => m.authorId))] } }, select: { id: true, name: true, role: true } })
    const m = new Map(us.map((u) => [u.id, u]))
    return msgs.map((x) => ({ id: x.id, authorId: x.authorId, authorName: m.get(x.authorId)?.name ?? 'unknown', authorRole: m.get(x.authorId)?.role, body: x.body, createdAt: x.createdAt }))
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const l = await this.load(user, id)
    const [row] = await this.decorate([l])
    return { ...row, messages: await this.thread(id) }
  }

  @Post(':id/messages')
  async message(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MessageDto) {
    const l = await this.load(user, id)
    const body = dto.body.trim()
    if (!body) throw new BadRequestException('Write a message first')
    await this.prisma.leaveMessage.create({ data: { schoolId: l.schoolId, leaveId: id, authorId: user.id, body } })
    await this.bus.emit('leave.message', { schoolId: l.schoolId, leaveId: id, authorId: user.id, authorName: user.name, requesterId: l.requesterId, subjectUserId: l.subjectUserId, decidedById: l.decidedById })
    return this.thread(id)
  }

  @Post('bulk-approve')
  @RequirePermission('leave', 'bulk_approve')
  async bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkDecideDto) {
    if (dto.decision === 'reject' && !dto.reason?.trim()) throw new BadRequestException('A shared reason is required for bulk reject')
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) results.push(await this.decideOne(user, id, dto.decision, dto.reason, bulkId))
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'leave', action: dto.decision, recordIds: ids, reason: dto.reason, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: `leave.bulk_${dto.decision}`, resource: 'leave', bulkId, meta: { count: ids.length, succeeded: summary.succeeded, reason: dto.reason ?? null } })
    return { bulkId, ...summary, results }
  }

  /** Single-item decision; bulk calls this for every id. One event per request, as for a single approval. */
  private async decideOne(user: AuthUser, id: string, decision: 'approve' | 'reject', reason?: string, bulkId?: string) {
    try {
      if (decision === 'reject' && !reason?.trim()) return { id, ok: false, error: 'Reason required to reject' }
      let evt: any = null
      await this.prisma.$transaction(async (tx) => {
        const l = await tx.leaveRequest.findUnique({ where: { id } })
        if (!l) throw new Error('Not found')
        if (!can(user, 'leave', 'approve', { schoolId: l.schoolId })) throw new Error('Not permitted')
        if (l.status !== 'pending') throw new Error(`Already ${l.status}`)
        const upd = await tx.leaveRequest.updateMany({ where: { id, status: 'pending' }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedById: user.id, decidedAt: new Date(), decisionNote: reason ?? null } })
        if (upd.count !== 1) throw new Error('Status changed')
        await this.audit.log(tx, { schoolId: l.schoolId, actorId: user.id, action: decision === 'approve' ? 'leave.approved' : 'leave.rejected', resource: 'leave', resourceId: id, bulkId, meta: { reason: reason ?? null } })
        // An approved leave turns days already marked absent into excused leave days.
        if (decision === 'approve') await applyApprovedLeave(tx, l, user.id)
        evt = { schoolId: l.schoolId, leaveId: id, requesterId: l.requesterId, subjectUserId: l.subjectUserId, decision, fromDate: day(l.fromDate), toDate: day(l.toDate), actorId: user.id }
      })
      if (evt) await this.bus.emit('leave.decided', evt)
      return { id, ok: true }
    } catch (e) {
      return { id, ok: false, error: (e as Error).message }
    }
  }
}

@Module({ controllers: [LeaveController] })
export class LeaveModule {}
