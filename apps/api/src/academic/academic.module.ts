import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'
import { DEFAULT_BANDS, loadBands } from './grades'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`)
const day = (d: Date) => d.toISOString().slice(0, 10)

class PeriodDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string
  @Matches(DATE_RE) startDate: string
  @Matches(DATE_RE) endDate: string
}
class BandDto {
  @IsNumber() @Min(0) @Max(100) minPercent: number
  @IsString() @MinLength(1) @MaxLength(12) grade: string
}
class ScaleDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => BandDto) bands: BandDto[]
}

function checkRange(startDate: string, endDate: string) {
  if (Number.isNaN(toDate(startDate).getTime()) || Number.isNaN(toDate(endDate).getTime())) throw new BadRequestException('Invalid date')
  if (endDate <= startDate) throw new BadRequestException('The end date must be after the start date')
}
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd

/** The school calendar (academic years and their terms) and the grade scale. Anyone signed in can read; principal and admin change. */
@Controller('academic')
@UseGuards(AuthGuard, PermissionGuard)
export class AcademicController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    const years = await this.prisma.academicYear.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, include: { terms: { orderBy: { startDate: 'asc' } } } })
    const today = day(new Date())
    const inTerm = years.flatMap((y) => y.terms).find((t) => day(t.startDate) <= today && today <= day(t.endDate))
    return {
      currentTermId: inTerm?.id ?? null,
      years: years.map((y) => ({ id: y.id, name: y.name, startDate: day(y.startDate), endDate: day(y.endDate), current: y.current, terms: y.terms.map((t) => ({ id: t.id, name: t.name, startDate: day(t.startDate), endDate: day(t.endDate) })) })),
    }
  }

  @Post('years')
  @RequirePermission('academic', 'manage')
  async addYear(@CurrentUser() user: AuthUser, @Body() dto: PeriodDto) {
    checkRange(dto.startDate, dto.endDate)
    const name = dto.name.trim()
    const others = await this.prisma.academicYear.findMany({ where: { schoolId: user.schoolId } })
    if (others.some((y) => y.name === name)) throw new ConflictException('A year with this name already exists')
    if (others.some((y) => overlaps(dto.startDate, dto.endDate, day(y.startDate), day(y.endDate)))) throw new BadRequestException('This year overlaps another academic year')
    const y = await this.prisma.academicYear.create({ data: { schoolId: user.schoolId, name, startDate: toDate(dto.startDate), endDate: toDate(dto.endDate), current: others.length === 0 } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.year_created', resource: 'academic_year', resourceId: y.id, meta: { name } })
    return { id: y.id }
  }

  @Post('years/:id/current')
  @RequirePermission('academic', 'manage')
  async setCurrent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const y = await this.prisma.academicYear.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!y) throw new NotFoundException()
    await this.prisma.$transaction([
      this.prisma.academicYear.updateMany({ where: { schoolId: user.schoolId }, data: { current: false } }),
      this.prisma.academicYear.update({ where: { id }, data: { current: true } }),
    ])
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.year_current', resource: 'academic_year', resourceId: id, meta: { name: y.name } })
    return { ok: true }
  }

  @Delete('years/:id')
  @RequirePermission('academic', 'manage')
  async removeYear(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const y = await this.prisma.academicYear.findFirst({ where: { id, schoolId: user.schoolId }, include: { terms: { select: { id: true } } } })
    if (!y) throw new NotFoundException()
    if (await this.prisma.exam.count({ where: { termId: { in: y.terms.map((t) => t.id) } } })) throw new ConflictException('Exams are recorded in this year, so it cannot be deleted')
    await this.prisma.academicYear.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.year_deleted', resource: 'academic_year', resourceId: id, meta: { name: y.name } })
    return { ok: true }
  }

  @Post('years/:id/terms')
  @RequirePermission('academic', 'manage')
  async addTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PeriodDto) {
    checkRange(dto.startDate, dto.endDate)
    const y = await this.prisma.academicYear.findFirst({ where: { id, schoolId: user.schoolId }, include: { terms: true } })
    if (!y) throw new NotFoundException()
    if (dto.startDate < day(y.startDate) || dto.endDate > day(y.endDate)) throw new BadRequestException(`A term must fall inside the year (${day(y.startDate)} to ${day(y.endDate)})`)
    const name = dto.name.trim()
    if (y.terms.some((t) => t.name === name)) throw new ConflictException('A term with this name already exists in this year')
    if (y.terms.some((t) => overlaps(dto.startDate, dto.endDate, day(t.startDate), day(t.endDate)))) throw new BadRequestException('This term overlaps another term')
    const t = await this.prisma.term.create({ data: { schoolId: user.schoolId, yearId: id, name, startDate: toDate(dto.startDate), endDate: toDate(dto.endDate) } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.term_created', resource: 'term', resourceId: t.id, meta: { name, year: y.name } })
    return { id: t.id }
  }

  @Delete('terms/:id')
  @RequirePermission('academic', 'manage')
  async removeTerm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const t = await this.prisma.term.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!t) throw new NotFoundException()
    if (await this.prisma.exam.count({ where: { termId: id } })) throw new ConflictException('Exams are recorded in this term, so it cannot be deleted')
    await this.prisma.term.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.term_deleted', resource: 'term', resourceId: id, meta: { name: t.name } })
    return { ok: true }
  }

  @Get('grade-scale')
  async scale(@CurrentUser() user: AuthUser) {
    const custom = await this.prisma.gradeBand.count({ where: { schoolId: user.schoolId } })
    return { isDefault: custom === 0, bands: await loadBands(this.prisma, user.schoolId) }
  }

  /** Replaces the whole scale. Grades already shown on report cards change with it, since they are worked out when viewed. */
  @Put('grade-scale')
  @RequirePermission('academic', 'manage')
  async setScale(@CurrentUser() user: AuthUser, @Body() dto: ScaleDto) {
    const bands = dto.bands.map((b) => ({ minPercent: Math.round(b.minPercent * 10) / 10, grade: b.grade.trim() }))
    if (bands.some((b) => !b.grade)) throw new BadRequestException('Every band needs a grade')
    if (new Set(bands.map((b) => b.grade.toLowerCase())).size !== bands.length) throw new BadRequestException('Each grade can appear once')
    if (new Set(bands.map((b) => b.minPercent)).size !== bands.length) throw new BadRequestException('Two bands cannot start at the same percentage')
    if (!bands.some((b) => b.minPercent === 0)) throw new BadRequestException('The lowest band must start at 0 so every mark gets a grade')
    await this.prisma.$transaction([
      this.prisma.gradeBand.deleteMany({ where: { schoolId: user.schoolId } }),
      this.prisma.gradeBand.createMany({ data: bands.map((b) => ({ schoolId: user.schoolId, ...b })) }),
    ])
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.grade_scale_set', resource: 'grade_scale', meta: { bands } })
    return { isDefault: false, bands: bands.sort((a, b) => b.minPercent - a.minPercent) }
  }

  /** Back to the built-in scale. */
  @Delete('grade-scale')
  @RequirePermission('academic', 'manage')
  async resetScale(@CurrentUser() user: AuthUser) {
    await this.prisma.gradeBand.deleteMany({ where: { schoolId: user.schoolId } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'academic.grade_scale_reset', resource: 'grade_scale' })
    return { isDefault: true, bands: DEFAULT_BANDS }
  }
}

@Module({ controllers: [AcademicController] })
export class AcademicModule {}
