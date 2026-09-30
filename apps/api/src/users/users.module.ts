import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { SCHOOL_ROLES, roleCan, type Role } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { PlanService } from '../billing/billing.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const tempPassword = () => randomBytes(9).toString('base64url')
/** Only an admin may create, change or remove the people who run the school. */
const TOP: Role[] = ['admin', 'principal']

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string
  @IsEmail() email: string
  @IsIn([...SCHOOL_ROLES]) role: Role
  @IsOptional() @IsString() @MaxLength(30) phone?: string
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string
  @IsOptional() @IsEmail() email?: string
  @IsOptional() @IsString() @MaxLength(30) phone?: string
}
class RoleDto {
  @IsIn([...SCHOOL_ROLES]) role: Role
}

@Controller('users')
@UseGuards(AuthGuard, PermissionGuard)
export class UsersController {
  constructor(private prisma: PrismaService, private audit: AuditService, private plans: PlanService) {}

  /** Lightweight lookup for forms (role requests, parent links). */
  @Get("directory")
  directory(@CurrentUser() user: AuthUser, @Query("role") role?: string) {
    if (!roleCan(user.role, "role_requests", "request") && !roleCan(user.role, "admissions", "write") && !roleCan(user.role, "users", "manage")) {
      throw new ForbiddenException();
    }
    return this.prisma.user.findMany({
      where: { schoolId: user.schoolId, active: true, ...(role ? { role: role as any } : {}) },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });
  }

  @Get()
  @RequirePermission("users", "manage")
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { schoolId: user.schoolId },
      select: { id: true, name: true, email: true, role: true, active: true, phone: true, mustChangePassword: true, createdAt: true },
      orderBy: { name: 'asc' },
    })
  }

  // ---- helpers

  private async target(actor: AuthUser, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, schoolId: actor.schoolId } })
    if (!u) throw new NotFoundException('User not found')
    // A principal manages everyone except admins and other principals.
    if (actor.role !== 'admin' && TOP.includes(u.role)) throw new ForbiddenException('Only an admin can manage this person')
    return u
  }

  private assertCanAssign(actor: AuthUser, role: Role) {
    if (actor.role !== 'admin' && TOP.includes(role)) throw new ForbiddenException('Only an admin can give the admin or principal role')
  }

  /** The school must never be left without an active admin. */
  private async assertNotLastAdmin(actor: AuthUser, u: { id: string; role: Role; active: boolean }) {
    if (u.role !== 'admin' || !u.active) return
    const others = await this.prisma.user.count({ where: { schoolId: actor.schoolId, role: 'admin', active: true, id: { not: u.id } } })
    if (others === 0) throw new BadRequestException('This is the only active admin. Make someone else an admin first.')
  }

  /** An email can belong to one person per school. The same address at two different schools is fine. */
  private async emailFree(schoolId: string, email: string, exceptId?: string) {
    const clash = await this.prisma.user.findFirst({ where: { schoolId, email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } })
    if (clash) throw new BadRequestException('Someone already uses that email address')
  }

  // ---- actions

  /** Creates a person with a one-time temporary password they must change at first sign-in. */
  @Post()
  @RequirePermission('users', 'manage')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    this.assertCanAssign(actor, dto.role)
    const email = dto.email.trim().toLowerCase()
    await this.emailFree(actor.schoolId, email)
    if (dto.role === 'student') await this.plans.assertStudentRoom(actor.schoolId)
    const pw = tempPassword()
    const u = await this.prisma.user.create({
      data: { schoolId: actor.schoolId, email, name: dto.name.trim(), role: dto.role, phone: dto.phone?.trim() || null, passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: true },
      select: { id: true, name: true, email: true, role: true, active: true, phone: true },
    })
    await this.audit.log(this.prisma, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.created', resource: 'user', resourceId: u.id, meta: { role: u.role } })
    return { user: u, tempPassword: pw }
  }

  @Patch(':id')
  @RequirePermission('users', 'manage')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    const u = await this.target(actor, id)
    const data: { name?: string; email?: string; phone?: string | null } = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase()
      if (email !== u.email) { await this.emailFree(actor.schoolId, email, u.id); data.email = email }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change')
    const upd = await this.prisma.user.update({ where: { id }, data, select: { id: true, name: true, email: true, role: true, active: true, phone: true } })
    await this.audit.log(this.prisma, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.updated', resource: 'user', resourceId: id, meta: { fields: Object.keys(data) } })
    return upd
  }

  /**
   * Changes a role directly (the request queue is still there for people asking for themselves).
   * Anything tied to the old role is cleaned up: class membership, parent links, class teacher and monitor.
   */
  @Put(':id/role')
  @RequirePermission('users', 'manage')
  async setRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RoleDto) {
    const u = await this.target(actor, id)
    if (u.id === actor.id) throw new BadRequestException('You cannot change your own role')
    this.assertCanAssign(actor, dto.role)
    if (u.role === dto.role) throw new BadRequestException('They already have that role')
    await this.assertNotLastAdmin(actor, u)
    if (dto.role === 'student' && u.active) await this.plans.assertStudentRoom(actor.schoolId)

    await this.prisma.$transaction(async (tx) => {
      if (u.role === 'student') {
        await tx.parentStudentLink.deleteMany({ where: { studentId: id } })
        await tx.class.updateMany({ where: { monitorId: id }, data: { monitorId: null } })
      }
      if (u.role === 'parent') await tx.parentStudentLink.deleteMany({ where: { parentId: id } })
      if (u.role === 'teacher') await tx.class.updateMany({ where: { classTeacherId: id }, data: { classTeacherId: null } })
      if (dto.role === 'student' || dto.role === 'teacher') await tx.classMember.updateMany({ where: { userId: id }, data: { roleInClass: dto.role } })
      else await tx.classMember.deleteMany({ where: { userId: id } })
      await tx.user.update({ where: { id }, data: { role: dto.role } })
      await this.audit.log(tx, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.role_changed', resource: 'user', resourceId: id, meta: { from: u.role, to: dto.role } })
    })
    return { id, role: dto.role }
  }

  /** Blocks sign-in and every existing session straight away. History is kept. */
  @Post(':id/deactivate')
  @RequirePermission('users', 'manage')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const u = await this.target(actor, id)
    if (u.id === actor.id) throw new BadRequestException('You cannot deactivate yourself')
    await this.assertNotLastAdmin(actor, u)
    await this.prisma.user.update({ where: { id }, data: { active: false } })
    await this.audit.log(this.prisma, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.deactivated', resource: 'user', resourceId: id })
    return { id, active: false }
  }

  @Post(':id/reactivate')
  @RequirePermission('users', 'manage')
  async reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const u = await this.target(actor, id)
    if (u.role === 'student' && !u.active) await this.plans.assertStudentRoom(actor.schoolId)
    await this.prisma.user.update({ where: { id }, data: { active: true } })
    await this.audit.log(this.prisma, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.reactivated', resource: 'user', resourceId: id })
    return { id, active: true }
  }

  /** New one-time password, shown once. They must change it at next sign-in. */
  @Post(':id/reset-password')
  @RequirePermission('users', 'manage')
  async resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const u = await this.target(actor, id)
    if (u.id === actor.id) throw new BadRequestException('Change your own password from Settings')
    const pw = tempPassword()
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: true } })
    await this.audit.log(this.prisma, { schoolId: actor.schoolId, actorId: actor.id, action: 'user.password_reset', resource: 'user', resourceId: id })
    return { id, name: u.name, email: u.email, tempPassword: pw }
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
