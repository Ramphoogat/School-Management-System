import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Put, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { visibleClassIds } from '../announcements/announcements.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

class SlotDto {
  @IsInt() @Min(1) @Max(7) dayOfWeek: number
  @IsInt() @Min(1) @Max(20) period: number
  @Matches(TIME) startTime: string
  @Matches(TIME) endTime: string
  @IsString() @MinLength(1) subject: string
  @IsOptional() @IsString() teacherId?: string
}
class SetTimetableDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SlotDto) slots: SlotDto[]
}

@Controller('timetable')
@UseGuards(AuthGuard, PermissionGuard)
export class TimetableController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async decorate(slots: Awaited<ReturnType<PrismaService['timetableSlot']['findMany']>>) {
    const [classes, teachers] = await Promise.all([
      this.prisma.class.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.classId))] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: slots.map((s) => s.teacherId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ])
    const c = new Map(classes.map((x) => [x.id, x.name]))
    const t = new Map(teachers.map((x) => [x.id, x.name]))
    return slots.map((s) => ({ ...s, className: c.get(s.classId) ?? '', teacherName: s.teacherId ? t.get(s.teacherId) ?? null : null }))
  }

  /** The user's own timetable: student's class, parent's children's classes, teacher's teaching slots, staff: everything. */
  @Get('me')
  async mine(@CurrentUser() user: AuthUser) {
    const visible = await visibleClassIds(this.prisma, user)
    const where =
      user.role === 'teacher'
        ? { schoolId: user.schoolId, OR: [{ teacherId: user.id }, { classId: { in: user.classIds ?? [] } }] }
        : visible === 'all'
          ? { schoolId: user.schoolId }
          : { schoolId: user.schoolId, classId: { in: visible } }
    const slots = await this.prisma.timetableSlot.findMany({ where, orderBy: [{ dayOfWeek: 'asc' }, { period: 'asc' }] })
    return this.decorate(slots)
  }

  @Get('class/:classId')
  async forClass(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    const visible = await visibleClassIds(this.prisma, user)
    const teaches = user.role === 'teacher' && (await this.prisma.timetableSlot.count({ where: { classId, teacherId: user.id } })) > 0
    if (visible !== 'all' && !visible.includes(classId) && !teaches) throw new ForbiddenException()
    return this.decorate(await this.prisma.timetableSlot.findMany({ where: { classId }, orderBy: [{ dayOfWeek: 'asc' }, { period: 'asc' }] }))
  }

  /** Replaces a class's whole timetable in one transaction. */
  @Put('class/:classId')
  @RequirePermission('timetable', 'write')
  async set(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Body() dto: SetTimetableDto) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls || !can(user, 'timetable', 'write', { schoolId: cls.schoolId })) throw new ForbiddenException()

    const seen = new Set<string>()
    for (const s of dto.slots) {
      const key = `${s.dayOfWeek}:${s.period}`
      if (seen.has(key)) throw new BadRequestException(`Duplicate slot for day ${s.dayOfWeek}, period ${s.period}`)
      seen.add(key)
      if (s.endTime <= s.startTime) throw new BadRequestException(`Period ${s.period}: end time must be after start time`)
    }
    const teacherIds = [...new Set(dto.slots.map((s) => s.teacherId).filter((x): x is string => !!x))]
    if (teacherIds.length) {
      const ok = await this.prisma.user.count({ where: { id: { in: teacherIds }, schoolId: user.schoolId, role: 'teacher' } })
      if (ok !== teacherIds.length) throw new BadRequestException('Unknown teacher')
    }

    // Two periods of the same class cannot overlap in time on the same day.
    const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
    const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) => mins(a.startTime) < mins(b.endTime) && mins(b.startTime) < mins(a.endTime)
    for (const [i, a] of dto.slots.entries()) {
      for (const b of dto.slots.slice(i + 1)) {
        if (a.dayOfWeek === b.dayOfWeek && overlaps(a, b)) throw new BadRequestException(`${DAY[a.dayOfWeek]}: period ${a.period} (${a.startTime}-${a.endTime}) overlaps period ${b.period} (${b.startTime}-${b.endTime})`)
      }
    }

    // A teacher cannot be in two classes at once.
    if (teacherIds.length) {
      const others = await this.prisma.timetableSlot.findMany({ where: { schoolId: user.schoolId, classId: { not: classId }, teacherId: { in: teacherIds } } })
      for (const s of dto.slots) {
        const clash = s.teacherId ? others.find((o) => o.teacherId === s.teacherId && o.dayOfWeek === s.dayOfWeek && overlaps(s, o)) : undefined
        if (clash) {
          const [teacher, other] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: s.teacherId! }, select: { name: true } }),
            this.prisma.class.findUnique({ where: { id: clash.classId }, select: { name: true } }),
          ])
          throw new BadRequestException(`${teacher?.name ?? 'This teacher'} is already teaching ${other?.name ?? 'another class'} on ${DAY[s.dayOfWeek]} ${clash.startTime}-${clash.endTime}`)
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.timetableSlot.deleteMany({ where: { classId } })
      if (dto.slots.length) {
        await tx.timetableSlot.createMany({
          data: dto.slots.map((s) => ({ schoolId: user.schoolId, classId, dayOfWeek: s.dayOfWeek, period: s.period, startTime: s.startTime, endTime: s.endTime, subject: s.subject.trim(), teacherId: s.teacherId || null })),
        })
      }
      await this.audit.log(tx, { schoolId: user.schoolId, actorId: user.id, action: 'timetable.updated', resource: 'timetable', resourceId: classId, meta: { slots: dto.slots.length } })
    })
    return this.decorate(await this.prisma.timetableSlot.findMany({ where: { classId }, orderBy: [{ dayOfWeek: 'asc' }, { period: 'asc' }] }))
  }
}

@Module({ controllers: [TimetableController] })
export class TimetableModule {}
