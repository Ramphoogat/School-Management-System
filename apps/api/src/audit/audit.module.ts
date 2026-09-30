import { Controller, Get, Global, Injectable, Module, Query, UseGuards } from '@nestjs/common'
import { Prisma } from '@school/db'
import { PrismaService } from '../prisma/prisma.module'
import { LiveGateway, kindsFor } from '../live/live.module'
import { AuthGuard, CurrentUser, RequirePermission, PermissionGuard, type AuthUser } from '../auth/guards'

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService, private live: LiveGateway) {}

  /** Records the change, then tells connected browsers which screens it touches so queues refresh on their own. */
  async log(
    tx: Prisma.TransactionClient | PrismaService,
    e: { schoolId: string; actorId: string; action: string; resource: string; resourceId?: string; bulkId?: string; meta?: Prisma.InputJsonValue },
  ) {
    const row = await tx.auditLog.create({ data: e })
    this.live.changed(e.schoolId, kindsFor(e.action))
    return row
  }
}

@Controller('audit')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit', 'read')
  async list(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') pageSize = '25') {
    const size = Math.min(Math.max(Number(pageSize) || 25, 1), 500)
    const where = { schoolId: user.schoolId }
    const total = await this.prisma.auditLog.count({ where })
    const pages = Math.max(1, Math.ceil(total / size))
    const current = Math.min(Math.max(Number(page) || 1, 1), pages)
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (current - 1) * size, take: size })
    return { rows, total, page: current, pageSize: size, pages }
  }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
