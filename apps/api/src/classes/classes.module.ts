import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { roleCan } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

class CreateClassDto {
  @IsString() @MinLength(1) name: string
}

class AddMembersDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) userIds: string[]
}
class ClassTeacherDto {
  /** null clears the class teacher. */
  @IsOptional() @IsString() teacherId?: string | null
}

class ChannelDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string
  /** Icon key from the picker, e.g. "flask". The web app falls back to # for keys it does not know. */
  @IsOptional() @Matches(/^[a-z0-9-]{1,20}$/) icon?: string
}
class MonitorDto {
  /** null clears the monitor. */
  @IsOptional() @IsString() studentId?: string | null
}

const DEFAULT_CHANNELS = ['announcements', 'attendance', 'homework', 'chat', 'voice', 'resources', 'books', 'grades']

@Controller('classes')
@UseGuards(AuthGuard, PermissionGuard)
export class ClassesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Staff-level roles see every class; others see classes they belong to or their linked children's classes. */
  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    return this.withTeacherNames(await this.visible(user))
  }

  private async withTeacherNames<T extends { classTeacherId: string | null; monitorId: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.classTeacherId, r.monitorId]).filter(Boolean))] as string[]
    const us = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
    const m = new Map(us.map((u) => [u.id, u.name]))
    return rows.map((r) => ({ ...r, classTeacherName: r.classTeacherId ? m.get(r.classTeacherId) ?? null : null, monitorName: r.monitorId ? m.get(r.monitorId) ?? null : null }))
  }

  private async visible(user: AuthUser) {
    const include = { channels: true, _count: { select: { members: true } } }
    if (['principal', 'admin', 'clerk'].includes(user.role)) {
      return this.prisma.class.findMany({ where: { schoolId: user.schoolId, deletedAt: null }, include, orderBy: { name: 'asc' } })
    }
    const classIds = new Set(user.classIds ?? [])
    if (user.role === 'parent' && user.linkedStudentIds?.length) {
      const ms = await this.prisma.classMember.findMany({ where: { userId: { in: user.linkedStudentIds } }, select: { classId: true } })
      ms.forEach((m) => classIds.add(m.classId))
    }
    // Deleted classes are hidden from everyone here; the principal and admin see them under "Deleted classes".
    return this.prisma.class.findMany({ where: { schoolId: user.schoolId, deletedAt: null, id: { in: [...classIds] } }, include, orderBy: { name: 'asc' } })
  }

  /** A class of this school that has not been deleted. */
  private async ownClass(user: AuthUser, id: string) {
    const cls = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId, deletedAt: null } })
    if (!cls) throw new NotFoundException('Class not found')
    return cls
  }

  /** The classes that were deleted and can be brought back. Principal and admin only. */
  @Get('deleted')
  @RequirePermission('classes', 'delete')
  async deleted(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.class.findMany({
      where: { schoolId: user.schoolId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: { _count: { select: { members: true } } },
    })
    const ids = [...new Set(rows.map((r) => r.deletedById).filter(Boolean))] as string[]
    const people = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
    const who = new Map(people.map((p) => [p.id, p.name]))
    return rows.map((r) => ({ id: r.id, name: r.name, deletedAt: r.deletedAt, deletedByName: r.deletedById ? who.get(r.deletedById) ?? null : null, members: r._count.members }))
  }

  /**
   * Deletes a class the way a recycle bin does: it disappears for its students, teachers and parents and from every list,
   * but nothing is erased (members, homework, marks, files and chat stay), and it can be restored.
   */
  @Delete(':id')
  @RequirePermission('classes', 'delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.ownClass(user, id)
    const members = await this.prisma.classMember.count({ where: { classId: id } })
    await this.prisma.class.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.deleted', resource: 'class', resourceId: id, meta: { name: cls.name, members } })
    return { ok: true, id, name: cls.name }
  }

  /** Brings a deleted class back exactly as it was. */
  @Post(':id/restore')
  @RequirePermission('classes', 'delete')
  async restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.prisma.class.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!cls) throw new NotFoundException('Class not found')
    if (!cls.deletedAt) throw new BadRequestException('This class is not deleted')
    await this.prisma.class.update({ where: { id }, data: { deletedAt: null, deletedById: null } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.restored', resource: 'class', resourceId: id, meta: { name: cls.name } })
    return { ok: true, id, name: cls.name }
  }

  /** Who is in the class, who is the class teacher, and who could still be added. */
  @Get(':id/members')
  async members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cls = await this.ownClass(user, id)
    const canWrite = roleCan(user.role, 'classes', 'write')
    // Class managers see everything; a teacher sees the roster of a class they belong to.
    if (!canWrite && !(user.role === 'teacher' && (user.classIds ?? []).includes(id))) throw new ForbiddenException()
    const rows = await this.prisma.classMember.findMany({ where: { classId: id }, include: { user: { select: { id: true, name: true, email: true, active: true } } } })
    const inClass = new Set(rows.map((r) => r.userId))
    const candidates = !canWrite ? [] : await this.prisma.user.findMany({
      where: { schoolId: user.schoolId, active: true, role: { in: ['student', 'teacher'] }, id: { notIn: [...inClass] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    return {
      classTeacherId: cls.classTeacherId,
      monitorId: cls.monitorId,
      members: rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email, role: r.roleInClass })).sort((a, b) => a.name.localeCompare(b.name)),
      available: candidates,
    }
  }

  /** Adds students and teachers. Each person joins with their own role; anyone already in the class is skipped. */
  @Post(':id/members')
  @RequirePermission('classes', 'write')
  async addMembers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMembersDto) {
    await this.ownClass(user, id)
    const users = await this.prisma.user.findMany({ where: { id: { in: dto.userIds }, schoolId: user.schoolId, active: true, role: { in: ['student', 'teacher'] } }, select: { id: true, role: true } })
    if (users.length === 0) throw new BadRequestException('Choose students or teachers from this school')
    const r = await this.prisma.classMember.createMany({ data: users.map((u) => ({ classId: id, userId: u.id, roleInClass: u.role })), skipDuplicates: true })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.members_added', resource: 'class', resourceId: id, meta: { added: r.count } })
    return { added: r.count, skipped: dto.userIds.length - r.count }
  }

  @Delete(':id/members/:userId')
  @RequirePermission('classes', 'write')
  async removeMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    const cls = await this.ownClass(user, id)
    await this.prisma.$transaction(async (tx) => {
      await tx.classMember.deleteMany({ where: { classId: id, userId } })
      if (cls.classTeacherId === userId) await tx.class.update({ where: { id }, data: { classTeacherId: null } })
      if (cls.monitorId === userId) await tx.class.update({ where: { id }, data: { monitorId: null } })
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.member_removed', resource: 'class', resourceId: id, meta: { userId } })
    return { ok: true }
  }

  /** Sets (or clears) the class teacher. The teacher is added to the class if they are not already in it. */
  @Put(':id/class-teacher')
  @RequirePermission('classes', 'write')
  async setClassTeacher(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ClassTeacherDto) {
    await this.ownClass(user, id)
    const teacherId = dto.teacherId || null
    if (teacherId) {
      const t = await this.prisma.user.findFirst({ where: { id: teacherId, schoolId: user.schoolId, active: true, role: 'teacher' }, select: { id: true } })
      if (!t) throw new BadRequestException('Choose a teacher from this school')
    }
    await this.prisma.$transaction(async (tx) => {
      if (teacherId) await tx.classMember.createMany({ data: [{ classId: id, userId: teacherId, roleInClass: 'teacher' }], skipDuplicates: true })
      await tx.class.update({ where: { id }, data: { classTeacherId: teacherId } })
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.teacher_set', resource: 'class', resourceId: id, meta: { teacherId } })
    return { classTeacherId: teacherId }
  }

  /**
   * Only a teacher of this class picks the class monitor (admins and principals cannot).
   * The monitor must be a student in the class; null clears it.
   */
  @Put(':id/monitor')
  async setMonitor(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MonitorDto) {
    const cls = await this.ownClass(user, id)
    const teaches = user.role === 'teacher' && (user.classIds ?? []).includes(id)
    if (!teaches) throw new ForbiddenException('Only a teacher of this class can choose the monitor')
    const studentId = dto.studentId || null
    if (studentId) {
      const m = await this.prisma.classMember.findFirst({ where: { classId: id, userId: studentId, roleInClass: 'student' }, select: { userId: true } })
      if (!m) throw new BadRequestException('The monitor must be a student in this class')
    }
    await this.prisma.class.update({ where: { id: cls.id }, data: { monitorId: studentId } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.monitor_set', resource: 'class', resourceId: id, meta: { studentId } })
    return { monitorId: studentId }
  }

  /** Who may add or remove channels: class managers, and a teacher of the class. */
  private canManageChannels(user: AuthUser, classId: string) {
    return roleCan(user.role, 'classes', 'write') || (user.role === 'teacher' && (user.classIds ?? []).includes(classId))
  }

  /** Adds a custom text channel (like chat, with its own messages). Voice channels are created from the voice page. */
  @Post(':id/channels')
  async addChannel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ChannelDto) {
    await this.ownClass(user, id)
    if (!this.canManageChannels(user, id)) throw new ForbiddenException()
    const name = dto.name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
    if (!name) throw new BadRequestException('Use letters or numbers in the channel name')
    if (await this.prisma.channel.findFirst({ where: { classId: id, name: { equals: name, mode: 'insensitive' } } })) throw new BadRequestException('This class already has a channel with that name')
    const ch = await this.prisma.channel.create({ data: { classId: id, type: 'text', name, icon: dto.icon ?? null } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'channel.created', resource: 'channel', resourceId: ch.id, meta: { classId: id, name } })
    return ch
  }

  /** Only custom text channels can be removed; the standard ones stay. Their messages go with them. */
  @Delete(':id/channels/:channelId')
  async removeChannel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('channelId') channelId: string) {
    await this.ownClass(user, id)
    if (!this.canManageChannels(user, id)) throw new ForbiddenException()
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, classId: id } })
    if (!ch) throw new NotFoundException('Channel not found')
    if (ch.type !== 'text') throw new BadRequestException('The standard channels cannot be removed')
    await this.prisma.$transaction([
      this.prisma.chatMessage.deleteMany({ where: { channelId } }),
      this.prisma.channel.delete({ where: { id: channelId } }),
    ])
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'channel.deleted', resource: 'channel', resourceId: channelId, meta: { classId: id, name: ch.name } })
    return { ok: true }
  }

  @Post()
  @RequirePermission('classes', 'write')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateClassDto) {
    const name = dto.name.trim()
    if (!name) throw new BadRequestException('Give the class a name')
    // A class's name stays reserved while it is deleted, so say so instead of failing with a database error.
    const same = await this.prisma.class.findFirst({ where: { schoolId: user.schoolId, name: { equals: name, mode: 'insensitive' } } })
    if (same) throw new BadRequestException(same.deletedAt ? `A class called "${same.name}" was deleted. Restore it from "Deleted classes", or choose a different name.` : `A class called "${same.name}" already exists.`)
    const cls = await this.prisma.class.create({
      data: {
        schoolId: user.schoolId,
        name,
        channels: { create: DEFAULT_CHANNELS.map((t) => ({ type: t, name: t })) },
      },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'class.created', resource: 'class', resourceId: cls.id })
    return cls
  }
}

@Module({ controllers: [ClassesController] })
export class ClassesModule {}
