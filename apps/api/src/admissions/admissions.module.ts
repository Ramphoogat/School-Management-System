import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { listLimit, setTotal } from '../common/total'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { PlanService } from '../billing/billing.module'
import { EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

class AdmissionDto {
  @IsString() classId: string
  @IsString() @MinLength(1) studentName: string
  @IsEmail() studentEmail: string
  @IsString() @MinLength(1) parentName: string
  @IsEmail() parentEmail: string
  @IsOptional() @IsString() parentPhone?: string
  @IsOptional() @IsString() relationship?: string
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean
}
class ImportRow {
  studentName?: string
  studentEmail?: string
  parentName?: string
  parentEmail?: string
  parentPhone?: string
  relationship?: string
  class?: string
  whatsappOptIn?: string | boolean
}
class ImportDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) rows: ImportRow[]
}
class BulkDecideDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[]
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject'
  @IsOptional() @IsString() reason?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const tempPassword = () => randomBytes(9).toString('base64url')
type Credential = { name: string; email: string; role: string; tempPassword: string }

@Controller('admissions')
@UseGuards(AuthGuard, PermissionGuard)
export class AdmissionsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus, private plans: PlanService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response, @Query('status') status = 'pending') {
    if (!can(user, 'admissions', 'write') && !can(user, 'admissions', 'approve')) throw new ForbiddenException()
    const where = { schoolId: user.schoolId, status: status as any }
    setTotal(res, await this.prisma.admission.count({ where }))
    const rows = await this.prisma.admission.findMany({ where, orderBy: { createdAt: 'asc' }, take: await listLimit(this.prisma, user.schoolId) })
    const classes = await this.prisma.class.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })
    const c = new Map(classes.map((x) => [x.id, x.name]))
    return rows.map((r) => ({ ...r, className: c.get(r.classId) ?? '' }))
  }

  @Post()
  @RequirePermission('admissions', 'write')
  async create(@CurrentUser() user: AuthUser, @Body() dto: AdmissionDto) {
    const cls = await this.prisma.class.findFirst({ where: { id: dto.classId, schoolId: user.schoolId } })
    if (!cls) throw new BadRequestException('Unknown class')
    const a = await this.insert(user, { ...dto, studentEmail: dto.studentEmail.toLowerCase(), parentEmail: dto.parentEmail.toLowerCase() })
    if (typeof a === 'string') throw new BadRequestException(a)
    return a
  }

  private async insert(user: AuthUser, d: AdmissionDto & { relationship?: string }) {
    const [dup, existing] = await Promise.all([
      this.prisma.admission.findFirst({ where: { schoolId: user.schoolId, studentEmail: d.studentEmail } }),
      this.prisma.user.findFirst({ where: { schoolId: user.schoolId, email: d.studentEmail } }),
    ])
    if (dup || existing) return 'A student with this email already exists or has an application'
    const a = await this.prisma.admission.create({
      data: { schoolId: user.schoolId, classId: d.classId, studentName: d.studentName.trim(), studentEmail: d.studentEmail, parentName: d.parentName.trim(), parentEmail: d.parentEmail, parentPhone: d.parentPhone?.trim() || null, relationship: d.relationship?.trim() || 'parent', whatsappOptIn: !!d.whatsappOptIn, createdById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'admission.created', resource: 'admission', resourceId: a.id })
    return a
  }

  /** Bulk import from CSV rows. Every row is validated and reported; good rows are not blocked by bad ones. */
  @Post('import')
  @RequirePermission('admissions', 'bulk_write')
  async import(@CurrentUser() user: AuthUser, @Body() dto: ImportDto) {
    const classes = await this.prisma.class.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })
    const byName = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]))
    const bulkId = randomUUID()
    const results: { row: number; ok: boolean; error?: string }[] = []
    const seen = new Set<string>()
    for (const [i, r] of dto.rows.entries()) {
      const row = i + 1
      const fail = (error: string) => results.push({ row, ok: false, error })
      const se = r.studentEmail?.trim().toLowerCase(), pe = r.parentEmail?.trim().toLowerCase()
      if (!r.studentName?.trim() || !r.parentName?.trim()) { fail('Student and parent name are required'); continue }
      if (!se || !EMAIL_RE.test(se) || !pe || !EMAIL_RE.test(pe)) { fail('Valid student and parent emails are required'); continue }
      if (seen.has(se)) { fail('Duplicate student email in this file'); continue }
      const classId = byName.get((r.class ?? '').trim().toLowerCase())
      if (!classId) { fail(`Unknown class "${r.class ?? ''}"`); continue }
      seen.add(se)
      const res = await this.insert(user, {
        classId, studentName: r.studentName, studentEmail: se, parentName: r.parentName, parentEmail: pe, parentPhone: r.parentPhone, relationship: r.relationship,
        whatsappOptIn: typeof r.whatsappOptIn === 'string' ? /^(yes|y|true|1)$/i.test(r.whatsappOptIn.trim()) : !!r.whatsappOptIn,
      })
      typeof res === 'string' ? fail(res) : results.push({ row, ok: true })
    }
    const summary = { total: results.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'admission', action: 'import', recordIds: [], resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'admission.bulk_import', resource: 'admission', bulkId, meta: { count: results.length, succeeded: summary.succeeded } })
    return { bulkId, ...summary }
  }

  @Post('bulk-approve')
  @RequirePermission('admissions', 'bulk_approve')
  async bulkApprove(@CurrentUser() user: AuthUser, @Body() dto: BulkDecideDto) {
    if (dto.decision === 'reject' && !dto.reason?.trim()) throw new BadRequestException('A shared reason is required for bulk reject')
    const ids = [...new Set(dto.ids)]
    const bulkId = randomUUID()
    const results: { id: string; ok: boolean; error?: string }[] = []
    const credentials: Credential[] = []
    for (const id of ids) {
      const r = await this.decideOne(user, id, dto.decision, dto.reason, bulkId)
      results.push({ id, ok: r.ok, error: r.error })
      credentials.push(...(r.credentials ?? []))
    }
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'admission', action: dto.decision, recordIds: ids, reason: dto.reason, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: `admission.bulk_${dto.decision}`, resource: 'admission', bulkId, meta: { count: ids.length, succeeded: summary.succeeded } })
    // Temporary passwords are returned once and never stored in plain text.
    return { bulkId, ...summary, results, credentials }
  }

  @Post(':id/decide')
  @RequirePermission('admissions', 'approve')
  async decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { decision: 'approve' | 'reject'; reason?: string }) {
    const r = await this.decideOne(user, id, dto.decision, dto.reason)
    if (!r.ok) throw new BadRequestException(r.error)
    return r
  }

  private async decideOne(user: AuthUser, id: string, decision: 'approve' | 'reject', reason?: string, bulkId?: string): Promise<{ ok: boolean; error?: string; credentials?: Credential[] }> {
    try {
      if (decision === 'reject' && !reason?.trim()) return { ok: false, error: 'Reason required to reject' }
      const creds: Credential[] = []
      if (decision === 'approve') {
        const pending = await this.prisma.admission.findUnique({ where: { id }, select: { schoolId: true, status: true } })
        if (pending?.status === 'pending') await this.plans.assertStudentRoom(pending.schoolId) // the school's plan may cap students
      }
      let admitted: { studentId: string; parentId: string; classId: string; studentName: string } | null = null
      await this.prisma.$transaction(async (tx) => {
        const a = await tx.admission.findUnique({ where: { id } })
        if (!a) throw new Error('Not found')
        if (!can(user, 'admissions', 'approve', { schoolId: a.schoolId })) throw new Error('Not permitted')
        if (a.status !== 'pending') throw new Error(`Already ${a.status}`)
        const upd = await tx.admission.updateMany({ where: { id, status: 'pending' }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedById: user.id, decidedAt: new Date(), reason: reason ?? null } })
        if (upd.count !== 1) throw new Error('Status changed')
        if (decision === 'approve') {
          if (await tx.user.findFirst({ where: { schoolId: a.schoolId, email: a.studentEmail } })) throw new Error('A user with the student email already exists')
          const stPw = tempPassword()
          const student = await tx.user.create({ data: { schoolId: a.schoolId, email: a.studentEmail, name: a.studentName, role: 'student', passwordHash: await bcrypt.hash(stPw, 10), mustChangePassword: true } })
          creds.push({ name: student.name, email: student.email, role: 'student', tempPassword: stPw })
          await tx.classMember.create({ data: { classId: a.classId, userId: student.id, roleInClass: 'student' } })

          let parent = await tx.user.findFirst({ where: { schoolId: a.schoolId, email: a.parentEmail } })
          if (parent && parent.role !== 'parent') throw new Error(`Parent email belongs to an existing ${parent.role} account`)
          if (!parent) {
            const pPw = tempPassword()
            parent = await tx.user.create({ data: { schoolId: a.schoolId, email: a.parentEmail, name: a.parentName, role: 'parent', phone: a.parentPhone, passwordHash: await bcrypt.hash(pPw, 10), mustChangePassword: true } })
            creds.push({ name: parent.name, email: parent.email, role: 'parent', tempPassword: pPw })
          } else if (a.parentPhone && !parent.phone) {
            await tx.user.update({ where: { id: parent.id }, data: { phone: a.parentPhone } })
          }
          // Opt-in collected at admission is recorded with its timestamp.
          if (a.whatsappOptIn) await tx.whatsAppConsent.upsert({ where: { userId: parent.id }, update: { optedIn: true }, create: { userId: parent.id, optedIn: true } })
          // Admin/principal approval of the admission also approves the parent link.
          await tx.parentStudentLink.upsert({ where: { parentId_studentId: { parentId: parent.id, studentId: student.id } }, update: { status: 'approved', approvedById: user.id }, create: { schoolId: a.schoolId, parentId: parent.id, studentId: student.id, relationship: a.relationship, status: 'approved', proposedById: a.createdById, approvedById: user.id } })
          await tx.admission.update({ where: { id }, data: { studentUserId: student.id } })
          admitted = { studentId: student.id, parentId: parent.id, classId: a.classId, studentName: student.name }
        }
        await this.audit.log(tx, { schoolId: a.schoolId, actorId: user.id, action: decision === 'approve' ? 'admission.approved' : 'admission.rejected', resource: 'admission', resourceId: id, bulkId, meta: { reason: reason ?? null } })
      })
      if (admitted) await this.bus.emit('student.admitted', { schoolId: user.schoolId, ...(admitted as any), actorId: user.id })
      return { ok: true, credentials: creds }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}

@Module({ controllers: [AdmissionsController] })
export class AdmissionsModule {}
