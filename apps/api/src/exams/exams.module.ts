import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Matches, Min, MinLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { randomUUID } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { EventBus } from '../events/events.module'
import { gradeFrom, loadBands } from '../academic/grades'
import { renderReportCardPdf } from '../pdf/pdf'
import { longDate, sendPdf } from '../pdf/send'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class CreateExamDto {
  @IsString() classId: string
  @IsString() @MinLength(1) name: string
  @IsString() @MinLength(1) subject: string
  @IsNumber() @Min(1) maxMarks: number
  @Matches(DATE_RE) date: string
  /** Optional; when left out the exam joins the term its date falls in, if any. */
  @IsOptional() @IsString() termId?: string
}
class MarkDto {
  @IsOptional() @IsString() studentId?: string
  /** Alternative to studentId, used by CSV import. */
  @IsOptional() @IsEmail() email?: string
  @IsOptional() @IsNumber() score?: number | null
  @IsOptional() @IsBoolean() absent?: boolean
}
class SetMarksDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MarkDto) marks: MarkDto[]
}
class BulkDecideDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject'
  @IsOptional() @IsString() reason?: string
}

const fmt = (e: { date: Date }) => e.date.toISOString().slice(0, 10)

@Controller('exams')
@UseGuards(AuthGuard, PermissionGuard)
export class ExamsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus) {}

  private async loadExam(user: AuthUser, id: string) {
    const e = await this.prisma.exam.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!e) throw new NotFoundException()
    return e
  }
  private canEditMarks(user: AuthUser, classId: string) {
    return can(user, 'results', 'bulk_write', { classId })
  }
  private canSeeAll(user: AuthUser, classId: string) {
    return can(user, 'results', 'write', { classId }) || can(user, 'results', 'read')
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateExamDto) {
    const cls = await this.prisma.class.findFirst({ where: { id: dto.classId, schoolId: user.schoolId, deletedAt: null } })
    if (!cls || !can(user, 'results', 'write', { classId: dto.classId })) throw new ForbiddenException()
    const when = new Date(`${dto.date}T00:00:00.000Z`)
    let termId: string | null = null
    if (dto.termId) {
      if (!(await this.prisma.term.findFirst({ where: { id: dto.termId, schoolId: user.schoolId } }))) throw new BadRequestException('Unknown term')
      termId = dto.termId
    } else {
      termId = (await this.prisma.term.findFirst({ where: { schoolId: user.schoolId, startDate: { lte: when }, endDate: { gte: when } }, select: { id: true } }))?.id ?? null
    }
    const e = await this.prisma.exam.create({
      data: { schoolId: user.schoolId, classId: dto.classId, name: dto.name.trim(), subject: dto.subject.trim(), maxMarks: dto.maxMarks, date: when, termId, createdById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'exam.created', resource: 'exam', resourceId: e.id })
    return { ...e, date: fmt(e) }
  }

  /** Exams for a class. Teachers and staff see every status; students and parents only see approved results. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('classId') classId: string) {
    if (!classId) throw new BadRequestException('classId required')
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    const all = this.canSeeAll(user, classId)
    if (!all) {
      const mine = user.role === 'student' ? (user.classIds ?? []).includes(classId) : user.role === 'parent' && (await this.prisma.classMember.count({ where: { classId, userId: { in: user.linkedStudentIds ?? [] } } })) > 0
      if (!mine) throw new ForbiddenException()
    }
    const rows = await this.prisma.exam.findMany({ where: { classId, ...(all ? {} : { status: 'approved' }) }, orderBy: { date: 'desc' }, include: { _count: { select: { marks: true } } } })
    return rows.map(({ _count, ...e }) => ({ ...e, date: fmt(e), markedCount: _count.marks, canEdit: this.canEditMarks(user, classId), canDelete: this.canDelete(user, e) }))
  }

  /**
   * Who may delete an exam. A class's teacher (or the principal) can delete one that is still a draft or was rejected, since
   * nothing has been published from it. Only the principal can delete one that was submitted or approved, because that removes
   * marks students and parents can already see.
   */
  private canDelete(user: AuthUser, e: { classId: string; schoolId: string; status: string }) {
    const leader = can(user, 'results', 'approve', { schoolId: e.schoolId })
    if (['draft', 'rejected'].includes(e.status)) return leader || can(user, 'results', 'write', { classId: e.classId })
    return leader
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('reason') reason?: string) {
    const e = await this.loadExam(user, id)
    if (!this.canDelete(user, e)) {
      throw new ForbiddenException(['draft', 'rejected'].includes(e.status) ? undefined : 'Only the principal can delete an exam that has been submitted or published')
    }
    const published = !['draft', 'rejected'].includes(e.status)
    if (published && !reason?.trim()) throw new BadRequestException('Give a reason for deleting an exam that was already submitted or published')
    const marks = await this.prisma.mark.count({ where: { examId: id } })
    await this.prisma.exam.delete({ where: { id } }) // its marks go with it
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'exam.deleted', resource: 'exam', resourceId: id, meta: { name: e.name, subject: e.subject, classId: e.classId, status: e.status, marks, reason: reason?.trim() ?? null } })
    return { ok: true, marksRemoved: marks }
  }

  /** Approval queue for principal (school scope). */
  @Get('queue')
  @RequirePermission('results', 'approve')
  async queue(@CurrentUser() user: AuthUser, @Query('status') status = 'submitted') {
    if (!['submitted', 'approved', 'rejected'].includes(status)) throw new BadRequestException()
    const rows = await this.prisma.exam.findMany({ where: { schoolId: user.schoolId, status: status as any }, orderBy: { submittedAt: 'asc' }, take: 500 })
    const [classes, users] = await Promise.all([
      this.prisma.class.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.classId))] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }),
    ])
    const c = new Map(classes.map((x) => [x.id, x.name]))
    const u = new Map(users.map((x) => [x.id, x.name]))
    const counts = await this.prisma.mark.groupBy({ by: ['examId'], where: { examId: { in: rows.map((r) => r.id) } }, _count: true })
    const n = new Map(counts.map((x) => [x.examId, x._count]))
    return rows.map((e) => ({ ...e, date: fmt(e), className: c.get(e.classId) ?? '', teacherName: u.get(e.createdById) ?? '', markedCount: n.get(e.id) ?? 0 }))
  }

  @Post('bulk-approve')
  @RequirePermission('results', 'bulk_approve')
  async bulkApprove(@CurrentUser() user: AuthUser, @Body() dto: BulkDecideDto) {
    if (dto.decision === 'reject' && !dto.reason?.trim()) throw new BadRequestException('A shared reason is required for bulk reject')
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) results.push(await this.decideOne(user, id, dto.decision, dto.reason, bulkId))
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'exam', action: dto.decision, recordIds: ids, reason: dto.reason, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: `results.bulk_${dto.decision}`, resource: 'exam', bulkId, meta: { count: ids.length, succeeded: summary.succeeded, reason: dto.reason ?? null } })
    return { bulkId, ...summary, results }
  }

  @Post(':id/decide')
  @RequirePermission('results', 'approve')
  async decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { decision: 'approve' | 'reject'; reason?: string }) {
    const r = await this.decideOne(user, id, dto.decision, dto.reason)
    if (!r.ok) throw new BadRequestException(r.error)
    return r
  }

  /** Single-item decision. Bulk calls this for every id, so there is one code path for checks. */
  private async decideOne(user: AuthUser, id: string, decision: 'approve' | 'reject', reason?: string, bulkId?: string) {
    try {
      if (decision === 'reject' && !reason?.trim()) return { id, ok: false, error: 'Reason required to reject' }
      const approvedMarks = await this.prisma.$transaction(async (tx) => {
        const e = await tx.exam.findUnique({ where: { id } })
        if (!e) throw new Error('Not found')
        if (!can(user, 'results', 'approve', { schoolId: e.schoolId })) throw new Error('Not permitted')
        if (e.status !== 'submitted') throw new Error(`Already ${e.status}`)
        const upd = await tx.exam.updateMany({ where: { id, status: 'submitted' }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedById: user.id, decidedAt: new Date(), reason: reason ?? null } })
        if (upd.count !== 1) throw new Error('Status changed')
        await this.audit.log(tx, { schoolId: e.schoolId, actorId: user.id, action: decision === 'approve' ? 'results.approved' : 'results.rejected', resource: 'exam', resourceId: id, bulkId, meta: { reason: reason ?? null } })
        return decision === 'approve' ? { exam: e, marks: await tx.mark.findMany({ where: { examId: id } }) } : null
      })
      // One event per student, exactly as if each result had been approved on its own.
      if (approvedMarks) {
        for (const m of approvedMarks.marks) {
          await this.bus.emit('results.approved', { schoolId: user.schoolId, examId: id, studentId: m.studentId, examName: approvedMarks.exam.name, subject: approvedMarks.exam.subject, score: m.absent ? null : m.score, maxMarks: approvedMarks.exam.maxMarks, actorId: user.id })
        }
      }
      return { id, ok: true }
    } catch (e) {
      return { id, ok: false, error: (e as Error).message }
    }
  }

  @Get(':id/marks')
  async marks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const e = await this.loadExam(user, id)
    const all = this.canSeeAll(user, e.classId)
    if (!all && e.status !== 'approved') throw new ForbiddenException()
    const [members, marks] = await Promise.all([
      this.prisma.classMember.findMany({ where: { classId: e.classId, roleInClass: 'student' }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: 'asc' } } }),
      this.prisma.mark.findMany({ where: { examId: id } }),
    ])
    const m = new Map(marks.map((x) => [x.studentId, x]))
    let rows = members.map((x) => ({ studentId: x.user.id, name: x.user.name, email: x.user.email, score: m.get(x.user.id)?.score ?? null, absent: m.get(x.user.id)?.absent ?? false }))
    if (!all) {
      const allowed = new Set(user.role === 'student' ? [user.id] : user.linkedStudentIds ?? [])
      rows = rows.filter((r) => allowed.has(r.studentId))
    }
    return { exam: { ...e, date: fmt(e) }, canEdit: this.canEditMarks(user, e.classId) && ['draft', 'rejected'].includes(e.status), marks: rows }
  }

  /** Bulk enter or import marks. Only while the exam is draft or was rejected. */
  @Put(':id/marks')
  async setMarks(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetMarksDto) {
    const e = await this.loadExam(user, id)
    if (!this.canEditMarks(user, e.classId)) throw new ForbiddenException()
    if (!['draft', 'rejected'].includes(e.status)) throw new BadRequestException(`Marks are locked while the exam is ${e.status}`)
    const members = await this.prisma.classMember.findMany({ where: { classId: e.classId, roleInClass: 'student' }, include: { user: { select: { id: true, email: true } } } })
    const byId = new Set(members.map((x) => x.user.id))
    const byEmail = new Map(members.map((x) => [x.user.email.toLowerCase(), x.user.id]))
    const bulkId = randomUUID()
    const results: { key: string; ok: boolean; error?: string }[] = []

    for (const r of dto.marks) {
      const key = r.studentId ?? r.email ?? '?'
      const studentId = r.studentId ?? (r.email ? byEmail.get(r.email.toLowerCase()) : undefined)
      if (!studentId || !byId.has(studentId)) { results.push({ key, ok: false, error: 'Not a student of this class' }); continue }
      const absent = !!r.absent
      if (!absent && r.score != null && (r.score < 0 || r.score > e.maxMarks)) { results.push({ key, ok: false, error: `Score must be between 0 and ${e.maxMarks}` }); continue }
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.mark.upsert({ where: { examId_studentId: { examId: id, studentId } }, update: { score: absent ? null : r.score ?? null, absent }, create: { examId: id, studentId, score: absent ? null : r.score ?? null, absent } })
          await this.audit.log(tx, { schoolId: user.schoolId, actorId: user.id, action: 'marks.entered', resource: 'mark', resourceId: studentId, bulkId, meta: { examId: id } })
        })
        results.push({ key, ok: true })
      } catch (err) { results.push({ key, ok: false, error: (err as Error).message }) }
    }
    const summary = { total: results.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'mark', action: 'enter', recordIds: dto.marks.map((m) => m.studentId ?? m.email ?? '?'), resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'marks.bulk_enter', resource: 'exam', resourceId: id, bulkId, meta: { count: results.length, succeeded: summary.succeeded } })
    return { bulkId, ...summary }
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const e = await this.loadExam(user, id)
    if (!can(user, 'results', 'write', { classId: e.classId })) throw new ForbiddenException()
    if (!['draft', 'rejected'].includes(e.status)) throw new BadRequestException(`Already ${e.status}`)
    const [students, marked] = await Promise.all([
      this.prisma.classMember.count({ where: { classId: e.classId, roleInClass: 'student' } }),
      this.prisma.mark.count({ where: { examId: id } }),
    ])
    if (students === 0 || marked < students) throw new BadRequestException(`Enter marks (or mark absent) for every student first: ${marked} of ${students} done`)
    await this.prisma.exam.update({ where: { id }, data: { status: 'submitted', submittedAt: new Date(), reason: null } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'results.submitted', resource: 'exam', resourceId: id })
    await this.bus.emit('results.submitted', { schoolId: user.schoolId, examId: id, classId: e.classId, name: e.name, actorId: user.id })
    return { ok: true }
  }
}

@Controller('results')
@UseGuards(AuthGuard, PermissionGuard)
export class ResultsController {
  constructor(private prisma: PrismaService) {}

  /** Report card: approved results only. Student: own. Parent: linked child. Staff with school read: any student. */
  @Get('student/:studentId')
  reportCard(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Query('termId') termId?: string) {
    return this.card(user, studentId, termId)
  }

  /** The same report card as a downloadable PDF. */
  @Get('student/:studentId/pdf')
  async reportCardPdf(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Res() res: Response, @Query('termId') termId?: string) {
    const card = await this.card(user, studentId, termId)
    const [school, term] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: user.schoolId }, select: { name: true, brandHue: true } }),
      termId ? this.prisma.term.findFirst({ where: { id: termId, schoolId: user.schoolId } }) : null,
    ])
    const pdf = await renderReportCardPdf({
      schoolName: school?.name ?? '', studentName: card.student.name, className: card.className, termLabel: term?.name ?? null,
      results: card.results, totalScore: card.totalScore, totalMax: card.totalMax, overallPercent: card.overallPercent, overallGrade: card.overallGrade,
      generatedOn: longDate(new Date()), brandHue: school?.brandHue ?? null,
    })
    sendPdf(res, pdf, `Report card ${card.student.name}${term ? ` ${term.name}` : ''}`)
  }

  private async card(user: AuthUser, studentId: string, termId?: string) {
    const st = await this.prisma.user.findFirst({ where: { id: studentId, schoolId: user.schoolId, role: 'student' }, select: { id: true, name: true } })
    if (!st || !can(user, 'results', 'read', { studentId })) throw new ForbiddenException()
    const marks = await this.prisma.mark.findMany({ where: { studentId, exam: { status: 'approved', ...(termId ? { termId } : {}) } }, include: { exam: true }, orderBy: { exam: { date: 'desc' } } })
    const cls = await this.prisma.classMember.findFirst({ where: { userId: studentId }, include: { class: { select: { name: true } } } })
    const bands = await loadBands(this.prisma, user.schoolId)
    const rows = marks.map((m) => {
      const pct = m.absent || m.score == null ? null : Math.round((m.score / m.exam.maxMarks) * 1000) / 10
      return { examId: m.examId, exam: m.exam.name, subject: m.exam.subject, date: fmt(m.exam), score: m.score, maxMarks: m.exam.maxMarks, absent: m.absent, percent: pct, grade: pct === null ? null : gradeFrom(bands, pct) }
    })
    const graded = rows.filter((r) => r.percent !== null)
    const totalScore = graded.reduce((a, r) => a + (r.score ?? 0), 0)
    const totalMax = graded.reduce((a, r) => a + r.maxMarks, 0)
    const overall = totalMax ? Math.round((totalScore / totalMax) * 1000) / 10 : null
    return { student: st, className: cls?.class.name ?? '', results: rows, totalScore, totalMax, overallPercent: overall, overallGrade: overall === null ? null : gradeFrom(bands, overall) }
  }
}

@Module({ controllers: [ExamsController, ResultsController] })
export class ExamsModule {}
