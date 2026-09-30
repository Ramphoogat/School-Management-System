import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Matches, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { randomUUID } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { EventBus } from '../events/events.module'
import { attendanceStats, studentsOnLeave } from './leave'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

const STATUSES = ['present', 'absent', 'late', 'leave'] as const
type Status = (typeof STATUSES)[number]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class RecordDto {
  @IsString() studentId: string
  @IsIn(STATUSES as unknown as string[]) status: Status
}
class BulkMarkDto {
  @Matches(DATE_RE) date: string
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => RecordDto) records: RecordDto[]
}

const today = () => new Date().toISOString().slice(0, 10)
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`)

@Controller('attendance')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus) {}

  private async loadClass(user: AuthUser, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    return cls
  }

  /** Roster with the day's marks (unmarked students have status null). */
  @Get('class/:classId')
  async roster(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Query('date') date = today()) {
    if (!DATE_RE.test(date)) throw new BadRequestException('Invalid date')
    await this.loadClass(user, classId)
    if (!can(user, 'attendance', 'write', { classId }) && !can(user, 'attendance', 'read')) throw new ForbiddenException()
    const members = await this.prisma.classMember.findMany({
      where: { classId, roleInClass: 'student' },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    })
    const marks = await this.prisma.attendance.findMany({ where: { classId, date: toDate(date) } })
    const m = new Map(marks.map((a) => [a.studentId, a.status]))
    // Anyone with an approved leave that day is flagged, so they are not marked absent by default.
    const leave = await studentsOnLeave(this.prisma, members.map((x) => x.user.id), date)
    return { date, students: members.map((x) => ({ id: x.user.id, name: x.user.name, status: m.get(x.user.id) ?? null, onLeave: leave.has(x.user.id), leaveReason: leave.get(x.user.id)?.reason ?? null })) }
  }

  /** Bulk marking: same per-student check, one audit entry per student plus a bulk entry. */
  @Post('class/:classId/bulk')
  async bulk(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Body() dto: BulkMarkDto) {
    await this.loadClass(user, classId)
    if (!can(user, 'attendance', 'bulk_write', { classId })) throw new ForbiddenException()
    if (dto.date > today()) throw new BadRequestException('Cannot mark attendance for a future date')

    const members = await this.prisma.classMember.findMany({ where: { classId, roleInClass: 'student' }, select: { userId: true } })
    const roster = new Set(members.map((x) => x.userId))
    const bulkId = randomUUID()
    const date = toDate(dto.date)
    const results: { studentId: string; ok: boolean; error?: string }[] = []
    // "On leave" can only be recorded for someone whose leave was approved for that day.
    const onLeave = await studentsOnLeave(this.prisma, dto.records.filter((r) => r.status === 'leave').map((r) => r.studentId), dto.date)

    for (const r of dto.records) {
      if (!roster.has(r.studentId)) {
        results.push({ studentId: r.studentId, ok: false, error: 'Not a student of this class' })
        continue
      }
      if (r.status === 'leave' && !onLeave.has(r.studentId)) {
        results.push({ studentId: r.studentId, ok: false, error: 'No approved leave for this student on that day' })
        continue
      }
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.attendance.upsert({
            where: { classId_studentId_date: { classId, studentId: r.studentId, date } },
            update: { status: r.status, markedById: user.id },
            create: { schoolId: user.schoolId, classId, studentId: r.studentId, date, status: r.status, markedById: user.id },
          })
          await this.audit.log(tx, { schoolId: user.schoolId, actorId: user.id, action: 'attendance.marked', resource: 'attendance', resourceId: r.studentId, bulkId, meta: { classId, date: dto.date, status: r.status } })
        })
        results.push({ studentId: r.studentId, ok: true })
        // One event per student, exactly as if marked individually.
        await this.bus.emit('attendance.marked', { schoolId: user.schoolId, classId, studentId: r.studentId, date: dto.date, status: r.status, actorId: user.id })
      } catch (e) {
        results.push({ studentId: r.studentId, ok: false, error: (e as Error).message })
      }
    }
    const summary = { total: results.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok) }
    await this.prisma.bulkActionLog.create({
      data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'attendance', action: 'mark', recordIds: dto.records.map((r) => r.studentId), resultSummary: summary as any },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'attendance.bulk_mark', resource: 'attendance', bulkId, meta: { classId, date: dto.date, count: results.length } })
    return { bulkId, ...summary }
  }

  /** Attendance summary for one student. Student: own. Parent: linked child. Staff: school. */
  @Get('student/:studentId')
  async student(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    const st = await this.prisma.user.findFirst({ where: { id: studentId, schoolId: user.schoolId, role: 'student' }, select: { id: true, name: true } })
    if (!st || !can(user, 'attendance', 'read', { studentId })) throw new ForbiddenException()
    const rows = await this.prisma.attendance.findMany({ where: { studentId }, orderBy: { date: 'desc' }, take: 90 })
    const stats = attendanceStats(rows) // leave days are excused, so they count neither for nor against
    return {
      student: st,
      percent: stats.percent,
      days: stats.days,
      recent: rows.slice(0, 14).map((r) => ({ date: r.date.toISOString().slice(0, 10), status: r.status })),
    }
  }

  /**
   * One month for the calendar: the student's daily marks, leave requests that touch the month, and what the school
   * said that month (class and school-wide announcements with who wrote them, and homework). Same access as the summary.
   */
  @Get('student/:studentId/calendar')
  async calendar(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Query('month') month = today().slice(0, 7)) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Invalid month')
    const st = await this.prisma.user.findFirst({ where: { id: studentId, schoolId: user.schoolId, role: 'student' }, select: { id: true, name: true } })
    if (!st || !can(user, 'attendance', 'read', { studentId })) throw new ForbiddenException()

    const [y, m] = month.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const next = new Date(Date.UTC(y, m, 1))
    // A day either side, so dates near the edge are right whatever timezone the viewer is in.
    const from = new Date(first.getTime() - 86_400_000)
    const to = new Date(next.getTime() + 86_400_000)

    const memberships = await this.prisma.classMember.findMany({ where: { userId: studentId }, select: { classId: true } })
    const classIds = memberships.map((x) => x.classId)

    const [marks, leaves, notes, work] = await Promise.all([
      this.prisma.attendance.findMany({ where: { studentId, date: { gte: first, lt: next } }, orderBy: { date: 'asc' } }),
      this.prisma.leaveRequest.findMany({ where: { subjectUserId: studentId, fromDate: { lt: next }, toDate: { gte: first } }, orderBy: { fromDate: 'asc' } }),
      this.prisma.announcement.findMany({ where: { schoolId: user.schoolId, createdAt: { gte: from, lt: to }, OR: [{ classId: null }, { classId: { in: classIds } }] }, orderBy: { createdAt: 'desc' } }),
      this.prisma.assignment.findMany({ where: { classId: { in: classIds }, OR: [{ dueDate: { gte: first, lt: next } }, { createdAt: { gte: from, lt: to } }] }, orderBy: { dueDate: 'asc' } }),
    ])

    const authorIds = [...new Set([...notes.map((n) => n.authorId), ...work.map((w) => w.createdById), ...leaves.map((l) => l.decidedById).filter(Boolean) as string[]])]
    const people = await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, role: true } })
    const who = new Map(people.map((p) => [p.id, p]))
    const day = (d: Date) => d.toISOString().slice(0, 10)

    return {
      student: st,
      month,
      days: marks.map((a) => ({ date: day(a.date), status: a.status })),
      leaves: leaves.map((l) => ({ id: l.id, fromDate: day(l.fromDate), toDate: day(l.toDate), status: l.status, reason: l.reason, decisionNote: l.decisionNote, decidedBy: l.decidedById ? who.get(l.decidedById)?.name ?? null : null })),
      messages: notes.map((n) => ({ id: n.id, title: n.title, body: n.body, urgent: n.urgent, createdAt: n.createdAt, scope: n.classId ? 'class' : 'school', authorName: who.get(n.authorId)?.name ?? 'School', authorRole: who.get(n.authorId)?.role ?? null })),
      homework: work.map((w) => ({ id: w.id, title: w.title, description: w.description, dueDate: day(w.dueDate), createdAt: w.createdAt, authorName: who.get(w.createdById)?.name ?? 'Teacher' })),
    }
  }
}

@Module({ controllers: [AttendanceController] })
export class AttendanceModule {}
