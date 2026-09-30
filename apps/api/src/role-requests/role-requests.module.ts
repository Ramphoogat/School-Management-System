import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from 'class-validator'
import { can, canManageRole, SCHOOL_ROLES, type Role } from '@school/permissions'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { PlanService } from '../billing/billing.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

class CreateRequestDto {
  @IsString() targetUserId: string
  @IsIn(SCHOOL_ROLES as unknown as string[]) requestedRole: Role
  @IsOptional() @IsString() note?: string
}
class DecideDto {
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject'
  @IsOptional() @IsString() reason?: string
}
class BulkDecideDto extends DecideDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
}

export type ItemResult = { id: string; ok: boolean; error?: string }

@Injectable()
export class RoleRequestsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private plans: PlanService) {}

  private async withNames<T extends { targetUserId: string; requestedById: string }>(rows: T[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.targetUserId, r.requestedById]))]
    const us = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } })
    const m = new Map(us.map((u) => [u.id, u]))
    return rows.map((r) => ({
      ...r,
      targetName: m.get(r.targetUserId)?.name ?? "unknown",
      currentRole: m.get(r.targetUserId)?.role,
      requestedByName: m.get(r.requestedById)?.name ?? "unknown",
    }))
  }

  async list(user: AuthUser, status?: string) {
    const rows = await this.prisma.roleRequest.findMany({
      where: { schoolId: user.schoolId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
    return this.withNames(rows)
  }

  async mine(user: AuthUser) {
    const rows = await this.prisma.roleRequest.findMany({
      where: { schoolId: user.schoolId, requestedById: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return this.withNames(rows)
  }

  async create(user: AuthUser, dto: CreateRequestDto) {
    const target = await this.prisma.user.findFirst({ where: { id: dto.targetUserId, schoolId: user.schoolId } })
    if (!target) throw new NotFoundException('Target user not found')
    const r = await this.prisma.roleRequest.create({
      data: {
        schoolId: user.schoolId,
        targetUserId: target.id,
        requestedRole: dto.requestedRole,
        requestedById: user.id,
        note: dto.note,
      },
    })
    await this.audit.log(this.prisma, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: 'user.role_requested',
      resource: 'role_request',
      resourceId: r.id,
    })
    return r
  }

  /** Single-item decision. Bulk calls exactly this, so there is one code path for checks. */
  async decideOne(user: AuthUser, id: string, decision: 'approve' | 'reject', reason?: string, bulkId?: string): Promise<ItemResult> {
    try {
      if (decision === 'reject' && !reason?.trim()) return { id, ok: false, error: 'Reason required to reject' }
      await this.prisma.$transaction(async (tx) => {
        const req = await tx.roleRequest.findUnique({ where: { id } })
        if (!req) throw new Error('Not found')
        if (!can(user, 'role_requests', 'approve', { schoolId: req.schoolId })) throw new Error('Not permitted')
        if (req.status !== 'pending') throw new Error(`Already ${req.status}`)
        if (decision === 'approve' && !canManageRole(user, req.targetUserId, req.requestedRole)) {
          throw new Error('You cannot grant this role')
        }
        if (decision === 'approve' && req.requestedRole === 'student') await this.plans.assertStudentRoom(req.schoolId)
        // Conditional update guards against concurrent decisions.
        const res = await tx.roleRequest.updateMany({
          where: { id, status: 'pending' },
          data: {
            status: decision === 'approve' ? 'approved' : 'rejected',
            decidedById: user.id,
            decidedAt: new Date(),
            reason: reason ?? null,
          },
        })
        if (res.count !== 1) throw new Error('Status changed')
        if (decision === 'approve') {
          await tx.user.update({ where: { id: req.targetUserId }, data: { role: req.requestedRole } })
        }
        await this.audit.log(tx, {
          schoolId: req.schoolId,
          actorId: user.id,
          action: decision === 'approve' ? 'user.role_approved' : 'user.role_rejected',
          resource: 'role_request',
          resourceId: id,
          bulkId,
          meta: { targetUserId: req.targetUserId, role: req.requestedRole, reason: reason ?? null },
        })
      })
      return { id, ok: true }
    } catch (e) {
      return { id, ok: false, error: (e as Error).message }
    }
  }

  async bulkDecide(user: AuthUser, dto: BulkDecideDto) {
    if (dto.decision === 'reject' && !dto.reason?.trim()) throw new BadRequestException('A shared reason is required for bulk reject')
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results: ItemResult[] = []
    for (const id of ids) results.push(await this.decideOne(user, id, dto.decision, dto.reason, bulkId))
    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
    }
    await this.prisma.bulkActionLog.create({
      data: {
        id: bulkId,
        schoolId: user.schoolId,
        actorId: user.id,
        resource: 'role_request',
        action: dto.decision,
        recordIds: ids,
        reason: dto.reason,
        resultSummary: summary as any,
      },
    })
    await this.audit.log(this.prisma, {
      schoolId: user.schoolId,
      actorId: user.id,
      action: `role_request.bulk_${dto.decision}`,
      resource: 'role_request',
      bulkId,
      meta: { count: ids.length, succeeded: summary.succeeded, reason: dto.reason ?? null },
    })
    return { bulkId, ...summary, results }
  }
}

@Controller('role-requests')
@UseGuards(AuthGuard, PermissionGuard)
export class RoleRequestsController {
  constructor(private svc: RoleRequestsService) {}

  @Get()
  @RequirePermission('role_requests', 'approve')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.list(user, status)
  }

  @Get("mine")
  @RequirePermission("role_requests", "request")
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.mine(user);
  }

  @Post()
  @RequirePermission("role_requests", "request")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.svc.create(user, dto)
  }

  // Declared before ':id' routes so 'bulk-approve' is never treated as an id.
  @Post('bulk-approve')
  @RequirePermission('role_requests', 'bulk_approve')
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkDecideDto) {
    return this.svc.bulkDecide(user, dto)
  }

  @Post(':id/decide')
  @RequirePermission('role_requests', 'approve')
  async decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideDto) {
    const r = await this.svc.decideOne(user, id, dto.decision, dto.reason)
    if (!r.ok) throw new BadRequestException(r.error)
    return r
  }
}

@Module({ providers: [RoleRequestsService], controllers: [RoleRequestsController], exports: [RoleRequestsService] })
export class RoleRequestsModule {}
