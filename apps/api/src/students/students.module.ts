import { Controller, ForbiddenException, Get, Module, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { listLimit, setTotal } from '../common/total'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

@Controller('students')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentsController {
  constructor(private prisma: PrismaService) {}

  /** Student records: class and approved parents. For roles that manage admissions or records. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response, @Query('q') q?: string, @Query('classId') classId?: string) {
    if (!can(user, 'admissions', 'write') && !can(user, 'admissions', 'approve')) throw new ForbiddenException()
    const where = {
      schoolId: user.schoolId,
      role: 'student' as const,
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] } : {}),
      ...(classId ? { memberships: { some: { classId } } } : {}),
    }
    setTotal(res, await this.prisma.user.count({ where }))
    const rows = await this.prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, active: true, createdAt: true,
        memberships: { select: { class: { select: { id: true, name: true } } } },
        asStudent: { where: { status: 'approved' }, select: { relationship: true, parent: { select: { name: true, email: true, phone: true } } } },
      },
      orderBy: { name: 'asc' },
      take: await listLimit(this.prisma, user.schoolId),
    })
    return rows.map(({ memberships, asStudent, ...s }) => ({ ...s, classes: memberships.map((m) => m.class), parents: asStudent.map((l) => ({ ...l.parent, relationship: l.relationship })) }))
  }
}

@Module({ controllers: [StudentsController] })
export class StudentsModule {}
