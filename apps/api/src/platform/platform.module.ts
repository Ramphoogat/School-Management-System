import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleInit, Param, Patch, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import type { Response } from 'express'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { addMonths, billingStatus, PlanService } from '../billing/billing.module'
import { SchoolDataService } from '../school-data/school-data.module'
import { LIST_LIMIT_MAX, LIST_LIMIT_MIN } from '../common/total'
import { cleanName, judgeUpload, type Upload } from '../storage/upload-rules'

const tempPassword = () => randomBytes(9).toString('base64url')

/** Addresses a school may not take: they are used by the platform itself. */
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'platform', 'superadmin', 's', 'static', 'assets', 'login', 'mail', 'support', 'help', 'docs', 'status', 'school', 'schools', 'demo', 'test'])
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/

const MAX_LOGO_BYTES = 512 * 1024

class CreateSchoolDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string
  @IsString() slug: string
  @IsString() @MinLength(2) @MaxLength(80) adminName: string
  @IsEmail() adminEmail: string
  @IsOptional() @IsString() @MaxLength(140) tagline?: string
  @IsOptional() @IsInt() @Min(0) @Max(360) brandHue?: number
}
class UpdateSchoolDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string
  @IsOptional() @IsString() slug?: string
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsString() @MaxLength(140) tagline?: string
  @IsOptional() @IsInt() @Min(0) @Max(360) brandHue?: number | null
  /** null takes the school off any plan (no limits, no expiry). */
  @IsOptional() @IsString() planId?: string | null
  /** The last day the school has paid up to; null = no expiry. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) planEndsOn?: string | null
}
const PAY_METHODS = ['bank', 'upi', 'cash', 'cheque', 'online', 'other']
class PlanDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string
  /** 0 = unlimited. */
  @IsInt() @Min(0) @Max(1_000_000) maxStudents: number
  /** Paise per month. */
  @IsInt() @Min(0) @Max(100_000_000) priceMonthly: number
}
class UpdatePlanDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) maxStudents?: number
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) priceMonthly?: number
  @IsOptional() @IsBoolean() active?: boolean
}
class PaymentDto {
  /** Paise received. */
  @IsInt() @Min(0) @Max(1_000_000_000) amount: number
  @IsIn(PAY_METHODS) method: string
  @IsOptional() @IsString() @MaxLength(80) reference?: string
  /** How many months this payment covers. */
  @IsInt() @Min(1) @Max(36) months: number
  @IsOptional() @IsString() @MaxLength(200) note?: string
}
class DeleteSchoolDto {
  /** The school's address, typed out, so a delete cannot happen by accident. */
  @IsString() confirm: string
}
class AdminDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string
  @IsEmail() email: string
}
class ListLimitDto {
  @IsInt() @Min(LIST_LIMIT_MIN) @Max(LIST_LIMIT_MAX) listLimit: number
}
class BrandingDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string
  @IsOptional() @IsString() @MaxLength(140) tagline?: string
  /** null clears the colour. */
  @IsOptional() @IsInt() @Min(0) @Max(360) brandHue?: number | null
}

/** What anyone may know about a school: enough to show its sign-in page. */
export function publicSchool(s: { slug: string | null; name: string; tagline: string | null; brandHue: number | null; logoKey: string | null; logoUpdatedAt: Date | null }) {
  return { slug: s.slug, name: s.name, tagline: s.tagline, brandHue: s.brandHue, logo: s.logoKey && s.slug ? `/api/tenant/${s.slug}/logo?v=${s.logoUpdatedAt?.getTime() ?? 0}` : null }
}

function checkSlug(raw: string): string {
  const slug = raw.trim().toLowerCase()
  if (!SLUG.test(slug)) throw new BadRequestException('The address needs 2 to 40 letters, numbers or hyphens, and cannot start or end with a hyphen')
  if (RESERVED.has(slug)) throw new BadRequestException('That address is reserved. Choose another.')
  return slug
}

/**
 * Creates the platform's super admin at startup when SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are set and none exists yet.
 * The super admin lives in a hidden platform school and can manage schools but never sees any school's own data.
 */
@Injectable()
export class PlatformBootstrap implements OnModuleInit {
  private log = new Logger('Platform')
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase()
    const password = process.env.SUPERADMIN_PASSWORD
    if (!email || !password) return
    if (password.length < 8) { this.log.warn('SUPERADMIN_PASSWORD must be at least 8 characters. No super admin was created.'); return }
    try {
      if (await this.prisma.user.findFirst({ where: { role: 'superadmin', email } })) return
      const home = (await this.prisma.school.findFirst({ where: { isPlatform: true } })) ?? (await this.prisma.school.create({ data: { name: 'Platform', isPlatform: true } }))
      await this.prisma.user.create({ data: { schoolId: home.id, email, name: 'Super Admin', role: 'superadmin', passwordHash: await bcrypt.hash(password, 10) } })
      this.log.log(`Super admin created: ${email}`)
    } catch (e) { this.log.error(`Could not create the super admin: ${(e as Error).message}`) }
  }
}

/** Public: how a school looks on its own sign-in page. No login needed, and nothing private is included. */
@Controller('tenant')
export class TenantController {
  constructor(private prisma: PrismaService) {}

  private async find(slug: string) {
    const s = await this.prisma.school.findFirst({ where: { slug: slug.toLowerCase(), active: true, isPlatform: false } })
    if (!s) throw new NotFoundException('School not found')
    return s
  }

  @Get(':slug')
  async one(@Param('slug') slug: string) {
    return publicSchool(await this.find(slug))
  }

  @Get(':slug/logo')
  async logo(@Param('slug') slug: string, @Res() res: Response) {
    const s = await this.find(slug)
    if (!s.logoKey || !s.logoMime) throw new NotFoundException()
    const data = await getFile(s.logoKey).catch(() => null)
    if (!data) throw new NotFoundException()
    res.set({ 'Content-Type': s.logoMime, 'Content-Length': String(data.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' })
    res.end(data)
  }
}

/** A school's own admin edits how the school looks. The address (slug) stays with the platform. */
@Controller('school')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolBrandingController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async mine(user: AuthUser) {
    const s = await this.prisma.school.findUnique({ where: { id: user.schoolId } })
    if (!s) throw new NotFoundException()
    return s
  }

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const s = await this.mine(user)
    return { id: s.id, ...publicSchool(s), listLimit: s.listLimit, listLimitMin: LIST_LIMIT_MIN, listLimitMax: LIST_LIMIT_MAX }
  }

  /** The most rows a long list (students, invoices, admissions, certificates, leave) sends at once. */
  @Put('list-limit')
  @RequirePermission('branding', 'manage')
  async setListLimit(@CurrentUser() user: AuthUser, @Body() dto: ListLimitDto) {
    const before = await this.mine(user)
    const s = await this.prisma.school.update({ where: { id: user.schoolId }, data: { listLimit: dto.listLimit } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'school.list_limit_changed', resource: 'school', resourceId: user.schoolId, meta: { from: before.listLimit, to: s.listLimit } })
    return { listLimit: s.listLimit, listLimitMin: LIST_LIMIT_MIN, listLimitMax: LIST_LIMIT_MAX }
  }

  @Put('branding')
  @RequirePermission('branding', 'manage')
  async branding(@CurrentUser() user: AuthUser, @Body() dto: BrandingDto) {
    await this.mine(user)
    const data: { name?: string; tagline?: string | null; brandHue?: number | null } = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.tagline !== undefined) data.tagline = dto.tagline.trim() || null
    if (dto.brandHue !== undefined) data.brandHue = dto.brandHue
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change')
    const s = await this.prisma.school.update({ where: { id: user.schoolId }, data })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'school.branding_updated', resource: 'school', resourceId: user.schoolId, meta: { fields: Object.keys(data) } })
    return { id: s.id, ...publicSchool(s) }
  }

  @Put('logo')
  @RequirePermission('branding', 'manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }))
  async logo(@CurrentUser() user: AuthUser, @UploadedFile() file: Upload | undefined) {
    const s = await this.mine(user)
    if (!file) throw new BadRequestException('Choose a logo (PNG or JPG, up to 500 KB)')
    const type = judgeUpload(file)
    const ext = file.originalname.split('.').pop()?.toLowerCase()
    if (!type || !['png', 'jpg', 'jpeg'].includes(ext ?? '')) throw new BadRequestException('The logo must be a PNG or JPG picture')
    const key = newKey()
    await putFile(key, file.buffer)
    const updated = await this.prisma.school.update({ where: { id: s.id }, data: { logoKey: key, logoMime: type.mime, logoUpdatedAt: new Date() } })
    if (s.logoKey) await deleteFile(s.logoKey)
    await this.audit.log(this.prisma, { schoolId: s.id, actorId: user.id, action: 'school.logo_updated', resource: 'school', resourceId: s.id, meta: { name: cleanName(file.originalname), size: file.size } })
    return { id: updated.id, ...publicSchool(updated) }
  }

  @Delete('logo')
  @RequirePermission('branding', 'manage')
  async removeLogo(@CurrentUser() user: AuthUser) {
    const s = await this.mine(user)
    if (s.logoKey) await deleteFile(s.logoKey)
    const updated = await this.prisma.school.update({ where: { id: s.id }, data: { logoKey: null, logoMime: null, logoUpdatedAt: new Date() } })
    await this.audit.log(this.prisma, { schoolId: s.id, actorId: user.id, action: 'school.logo_removed', resource: 'school', resourceId: s.id })
    return { id: updated.id, ...publicSchool(updated) }
  }
}

/** The super admin's screen: schools, and who runs each. Only metadata and counts; never a school's own records. */
@Controller('platform')
@UseGuards(AuthGuard, PermissionGuard)
export class PlatformController {
  constructor(private prisma: PrismaService, private audit: AuditService, private plans: PlanService, private data: SchoolDataService) {}

  private async school(id: string) {
    const s = await this.prisma.school.findFirst({ where: { id, isPlatform: false } })
    if (!s) throw new NotFoundException('School not found')
    return s
  }

  private async slugFree(slug: string, exceptId?: string) {
    if (await this.prisma.school.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })) throw new BadRequestException('That address is already taken')
  }

  private async newAdmin(schoolId: string, name: string, emailRaw: string) {
    const email = emailRaw.trim().toLowerCase()
    if (await this.prisma.user.findFirst({ where: { schoolId, email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) throw new BadRequestException('That email is already used at this school')
    const pw = tempPassword()
    const admin = await this.prisma.user.create({ data: { schoolId, email, name: name.trim(), role: 'admin', passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: true }, select: { id: true, name: true, email: true } })
    return { admin, tempPassword: pw }
  }

  @Get('schools')
  @RequirePermission('schools', 'manage')
  async list() {
    const schools = await this.prisma.school.findMany({ where: { isPlatform: false }, orderBy: { name: 'asc' }, include: { plan: true } })
    const counts = await this.prisma.user.groupBy({ by: ['schoolId', 'role'], where: { schoolId: { in: schools.map((s) => s.id) }, active: true }, _count: true })
    const n = (id: string, role?: string) => counts.filter((c) => c.schoolId === id && (!role || c.role === role)).reduce((a, c) => a + c._count, 0)
    return schools.map((s) => ({ id: s.id, ...publicSchool(s), active: s.active, createdAt: s.createdAt, people: n(s.id), students: n(s.id, 'student'), teachers: n(s.id, 'teacher'), plan: s.plan ? { id: s.plan.id, name: s.plan.name, maxStudents: s.plan.maxStudents } : null, planEndsOn: s.planEndsOn ? s.planEndsOn.toISOString().slice(0, 10) : null, billing: billingStatus(!!s.plan, s.planEndsOn).status }))
  }

  @Get('schools/:id')
  @RequirePermission('schools', 'manage')
  async detail(@Param('id') id: string) {
    const s = await this.school(id)
    const admins = await this.prisma.user.findMany({ where: { schoolId: id, role: 'admin' }, select: { id: true, name: true, email: true, active: true, mustChangePassword: true }, orderBy: { name: 'asc' } })
    return { id: s.id, ...publicSchool(s), active: s.active, createdAt: s.createdAt, admins, billing: await this.plans.summary(id) }
  }

  /** Creates a school and its first admin. The admin's one-time password is shown once. */
  @Post('schools')
  @RequirePermission('schools', 'manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSchoolDto) {
    const slug = checkSlug(dto.slug)
    await this.slugFree(slug)
    const school = await this.prisma.school.create({ data: { name: dto.name.trim(), slug, tagline: dto.tagline?.trim() || null, brandHue: dto.brandHue ?? null } })
    const { admin, tempPassword: pw } = await this.newAdmin(school.id, dto.adminName, dto.adminEmail)
    await this.audit.log(this.prisma, { schoolId: school.id, actorId: user.id, action: 'school.created', resource: 'school', resourceId: school.id, meta: { slug } })
    return { school: { id: school.id, ...publicSchool(school), active: true }, admin, tempPassword: pw }
  }

  @Patch('schools/:id')
  @RequirePermission('schools', 'manage')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSchoolDto) {
    const s = await this.school(id)
    const data: { name?: string; slug?: string; active?: boolean; tagline?: string | null; brandHue?: number | null; planId?: string | null; planEndsOn?: Date | null } = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.tagline !== undefined) data.tagline = dto.tagline.trim() || null
    if (dto.brandHue !== undefined) data.brandHue = dto.brandHue
    if (dto.slug !== undefined) { const slug = checkSlug(dto.slug); if (slug !== s.slug) { await this.slugFree(slug, id); data.slug = slug } }
    if (dto.active !== undefined) data.active = dto.active
    if (dto.planId !== undefined) {
      if (dto.planId !== null && !(await this.prisma.plan.findFirst({ where: { id: dto.planId, active: true }, select: { id: true } }))) throw new BadRequestException('That plan does not exist or is no longer offered')
      data.planId = dto.planId
    }
    if (dto.planEndsOn !== undefined) {
      if (dto.planEndsOn !== null && Number.isNaN(new Date(dto.planEndsOn).getTime())) throw new BadRequestException('Invalid date')
      data.planEndsOn = dto.planEndsOn ? new Date(`${dto.planEndsOn}T00:00:00.000Z`) : null
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change')
    const upd = await this.prisma.school.update({ where: { id }, data })
    const action = data.active === false ? 'school.suspended' : data.active === true && !s.active ? 'school.reactivated' : 'school.updated'
    await this.audit.log(this.prisma, { schoolId: id, actorId: user.id, action, resource: 'school', resourceId: id, meta: { fields: Object.keys(data) } })
    return { id: upd.id, ...publicSchool(upd), active: upd.active }
  }

  /** Another admin for a school, for example when the first one has left. */
  @Post('schools/:id/admins')
  @RequirePermission('schools', 'manage')
  async addAdmin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdminDto) {
    await this.school(id)
    const r = await this.newAdmin(id, dto.name, dto.email)
    await this.audit.log(this.prisma, { schoolId: id, actorId: user.id, action: 'school.admin_added', resource: 'user', resourceId: r.admin.id })
    return r
  }

  @Post('schools/:id/admins/:userId/reset-password')
  @RequirePermission('schools', 'manage')
  async resetAdmin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    await this.school(id)
    const admin = await this.prisma.user.findFirst({ where: { id: userId, schoolId: id, role: 'admin' }, select: { id: true, name: true, email: true } })
    if (!admin) throw new NotFoundException('Admin not found')
    const pw = tempPassword()
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: true, active: true } })
    await this.audit.log(this.prisma, { schoolId: id, actorId: user.id, action: 'school.admin_password_reset', resource: 'user', resourceId: userId })
    return { admin, tempPassword: pw }
  }

  // ---- plans and billing ----

  @Get('plans')
  @RequirePermission('schools', 'manage')
  async listPlans() {
    const [plans, counts] = await Promise.all([
      this.prisma.plan.findMany({ orderBy: [{ active: 'desc' }, { priceMonthly: 'asc' }] }),
      this.prisma.school.groupBy({ by: ['planId'], where: { planId: { not: null } }, _count: true }),
    ])
    const used = new Map(counts.map((c) => [c.planId, c._count]))
    return plans.map((p) => ({ ...p, schools: used.get(p.id) ?? 0 }))
  }

  @Post('plans')
  @RequirePermission('schools', 'manage')
  async createPlan(@CurrentUser() user: AuthUser, @Body() dto: PlanDto) {
    const name = dto.name.trim()
    if (await this.prisma.plan.findUnique({ where: { name } })) throw new ConflictException('A plan with this name already exists')
    const p = await this.prisma.plan.create({ data: { name, maxStudents: dto.maxStudents, priceMonthly: dto.priceMonthly } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'plan.created', resource: 'plan', resourceId: p.id, meta: { name } })
    return p
  }

  @Patch('plans/:id')
  @RequirePermission('schools', 'manage')
  async updatePlan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    const p = await this.prisma.plan.findUnique({ where: { id } })
    if (!p) throw new NotFoundException('Plan not found')
    const data: { name?: string; maxStudents?: number; priceMonthly?: number; active?: boolean } = {}
    if (dto.name !== undefined) {
      const name = dto.name.trim()
      if (name !== p.name && (await this.prisma.plan.findUnique({ where: { name } }))) throw new ConflictException('A plan with this name already exists')
      data.name = name
    }
    if (dto.maxStudents !== undefined) data.maxStudents = dto.maxStudents
    if (dto.priceMonthly !== undefined) data.priceMonthly = dto.priceMonthly
    if (dto.active !== undefined) data.active = dto.active
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change')
    const upd = await this.prisma.plan.update({ where: { id }, data })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'plan.updated', resource: 'plan', resourceId: id, meta: { fields: Object.keys(data) } })
    return upd
  }

  @Delete('plans/:id')
  @RequirePermission('schools', 'manage')
  async deletePlan(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.plan.findUnique({ where: { id } })
    if (!p) throw new NotFoundException('Plan not found')
    if (await this.prisma.school.count({ where: { planId: id } })) throw new ConflictException('Schools are on this plan. Move them to another plan first, or stop offering this one instead.')
    await this.prisma.plan.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'plan.deleted', resource: 'plan', resourceId: id, meta: { name: p.name } })
    return { ok: true }
  }

  /** A payment received from a school. It pays for the next months, counted from when the current period ends (or from today if it has run out). */
  @Post('schools/:id/payments')
  @RequirePermission('schools', 'manage')
  async recordPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PaymentDto) {
    const s = await this.school(id)
    if (!s.planId) throw new BadRequestException('Choose a plan for this school before recording a payment')
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
    const nextDay = s.planEndsOn ? new Date(s.planEndsOn.getTime() + 86_400_000) : today
    const periodFrom = nextDay > today ? nextDay : today
    const periodTo = new Date(addMonths(periodFrom, dto.months).getTime() - 86_400_000)
    const [pay] = await this.prisma.$transaction([
      this.prisma.schoolPayment.create({ data: { schoolId: id, amount: dto.amount, method: dto.method, reference: dto.reference?.trim() || null, months: dto.months, periodFrom, periodTo, note: dto.note?.trim() || null, recordedById: user.id } }),
      this.prisma.school.update({ where: { id }, data: { planEndsOn: periodTo } }),
    ])
    await this.audit.log(this.prisma, { schoolId: id, actorId: user.id, action: 'school.payment_recorded', resource: 'school', resourceId: id, meta: { amount: dto.amount, months: dto.months, method: dto.method, periodTo: periodTo.toISOString().slice(0, 10) } })
    return { id: pay.id, periodFrom: periodFrom.toISOString().slice(0, 10), periodTo: periodTo.toISOString().slice(0, 10) }
  }

  @Get('schools/:id/payments')
  @RequirePermission('schools', 'manage')
  async payments(@Param('id') id: string) {
    await this.school(id)
    const rows = await this.prisma.schoolPayment.findMany({ where: { schoolId: id }, orderBy: { createdAt: 'desc' }, take: 200 })
    return rows.map((p) => ({ id: p.id, amount: p.amount, method: p.method, reference: p.reference, months: p.months, periodFrom: p.periodFrom.toISOString().slice(0, 10), periodTo: p.periodTo.toISOString().slice(0, 10), note: p.note, createdAt: p.createdAt }))
  }

  // ---- deleting a school ----

  /**
   * Permanently deletes a school and everything it owns: people, classes, records, messages and stored files. It cannot be
   * undone, so the school must be suspended first and its address typed out. The super admin still cannot read any of it.
   * A record of the deletion (name, address, how many rows) is kept in the platform's own log.
   */
  @Delete('schools/:id')
  @RequirePermission('schools', 'manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeleteSchoolDto) {
    const s = await this.school(id)
    if (s.active) throw new ConflictException('Suspend the school first. Deleting is permanent, so it has to be stopped before it can be deleted.')
    if (dto.confirm.trim().toLowerCase() !== (s.slug ?? s.name).toLowerCase()) throw new BadRequestException("Type the school's address exactly to confirm")
    const people = await this.prisma.user.count({ where: { schoolId: id } })
    const result = await this.data.purge(id)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'school.deleted', resource: 'school', resourceId: id, meta: { name: s.name, slug: s.slug, people, files: result.files, rows: Object.values(result.counts).reduce((a, b) => a + b, 0) } })
    return { ok: true, deleted: { name: s.name, slug: s.slug, people, files: result.files } }
  }
}

@Module({ controllers: [TenantController, SchoolBrandingController, PlatformController], providers: [PlatformBootstrap] })
export class PlatformModule {}
