import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsString } from 'class-validator'
import { randomUUID } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { renderCertificatePdf } from '../pdf/pdf'
import { longDate, sendPdf } from '../pdf/send'
import { listLimit } from '../common/total'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const TYPES = ['bonafide', 'transfer', 'character'] as const
const CODE: Record<string, string> = { bonafide: 'BON', transfer: 'TC', character: 'CHR' }
export const TITLE: Record<string, string> = { bonafide: 'Bonafide certificate', transfer: 'Transfer certificate', character: 'Character certificate' }

/** The sentence on each kind of certificate. One place, so the screen, the print view and the PDF always agree. */
export function certificateText(type: string, name: string, className: string): string {
  if (type === 'transfer') return `This is to certify that ${name} was a student of this school (${className || 'class not recorded'}) and is granted a transfer certificate on request of the parent.`
  if (type === 'character') return `This is to certify that ${name} has been a student of this school (${className || 'class not recorded'}) and bears a good moral character.`
  return `This is to certify that ${name} is a bonafide student of this school, currently studying in ${className || 'the school'}.`
}

class BulkIssueDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @IsString({ each: true }) studentIds: string[]
  @IsIn(TYPES as unknown as string[]) type: (typeof TYPES)[number]
}

@Controller('certificates')
@UseGuards(AuthGuard, PermissionGuard)
export class CertificatesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Issues certificates for many students in one action. Each student is checked and numbered separately. */
  @Post('bulk-issue')
  @RequirePermission('certificates', 'bulk_write')
  async bulkIssue(@CurrentUser() user: AuthUser, @Body() dto: BulkIssueDto) {
    const ids = [...new Set(dto.studentIds)]
    const bulkId = randomUUID()
    const year = new Date().getFullYear()
    const results: { studentId: string; ok: boolean; number?: string; error?: string }[] = []
    for (const studentId of ids) {
      const st = await this.prisma.user.findFirst({ where: { id: studentId, schoolId: user.schoolId, role: 'student' } })
      if (!st || !can(user, 'certificates', 'bulk_write', { schoolId: st.schoolId })) { results.push({ studentId, ok: false, error: 'Student not found in this school' }); continue }
      let done = false
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const seq = (await this.prisma.certificate.count({ where: { schoolId: user.schoolId, type: dto.type } })) + 1 + attempt
          const number = `${CODE[dto.type]}-${year}-${String(seq).padStart(4, '0')}`
          const c = await this.prisma.certificate.create({ data: { schoolId: user.schoolId, studentId, type: dto.type, number, issuedById: user.id } })
          await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'certificate.issued', resource: 'certificate', resourceId: c.id, bulkId, meta: { type: dto.type, number } })
          results.push({ studentId, ok: true, number })
          done = true
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002' || attempt === 2) { results.push({ studentId, ok: false, error: 'Could not issue certificate' }); break }
        }
      }
    }
    const summary = { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'certificate', action: `issue_${dto.type}`, recordIds: ids, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'certificates.bulk_issue', resource: 'certificate', bulkId, meta: { type: dto.type, count: ids.length, succeeded: summary.succeeded } })
    return { bulkId, ...summary, results }
  }

  /** Student: own. Parent: linked child. Staff with school read: all (filter by studentId). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('studentId') studentId?: string) {
    const staff = can(user, 'certificates', 'read')
    let where: any = { schoolId: user.schoolId }
    if (staff) { if (studentId) where.studentId = studentId }
    else {
      const ids = user.role === 'student' ? [user.id] : user.linkedStudentIds ?? []
      if (!ids.length) return []
      where = { schoolId: user.schoolId, studentId: studentId ? (ids.includes(studentId) ? studentId : '__none__') : { in: ids } }
    }
    const rows = await this.prisma.certificate.findMany({ where, orderBy: { issuedAt: 'desc' }, take: await listLimit(this.prisma, user.schoolId) })
    const us = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, name: true } })
    const m = new Map(us.map((u) => [u.id, u.name]))
    return rows.map((r) => ({ ...r, studentName: m.get(r.studentId) ?? '' }))
  }

  /** A certificate with the names it needs. Same access rule for the screen and the PDF. */
  private async load(user: AuthUser, id: string) {
    const c = await this.prisma.certificate.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!c) throw new NotFoundException()
    if (!can(user, 'certificates', 'read', { studentId: c.studentId })) throw new ForbiddenException()
    const [st, school, cls] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: c.studentId }, select: { name: true } }),
      this.prisma.school.findUnique({ where: { id: c.schoolId }, select: { name: true, brandHue: true } }),
      this.prisma.classMember.findFirst({ where: { userId: c.studentId }, include: { class: { select: { name: true } } } }),
    ])
    return { c, studentName: st?.name ?? '', schoolName: school?.name ?? '', brandHue: school?.brandHue ?? null, className: cls?.class.name ?? '' }
  }

  @Get(':id')
  async one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { c, studentName, schoolName, className } = await this.load(user, id)
    return { ...c, studentName, schoolName, className, title: TITLE[c.type] ?? c.type, text: certificateText(c.type, studentName, className) }
  }

  /** The certificate as a downloadable PDF. */
  @Get(':id/pdf')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { c, studentName, schoolName, className, brandHue } = await this.load(user, id)
    const pdf = await renderCertificatePdf({ schoolName, title: TITLE[c.type] ?? c.type, text: certificateText(c.type, studentName, className), number: c.number, issuedOn: longDate(c.issuedAt), brandHue })
    sendPdf(res, pdf, `${TITLE[c.type] ?? 'Certificate'} ${c.number}`)
  }
}

@Module({ controllers: [CertificatesController] })
export class CertificatesModule {}
