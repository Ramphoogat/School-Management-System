import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { Channel, CHANNELS, EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

class PostAnnouncementDto {
  @IsOptional() @IsString() classId?: string
  @IsString() @MinLength(1) title: string
  @IsString() @MinLength(1) body: string
  @IsOptional() @IsBoolean() urgent?: boolean
  @IsOptional() @IsArray() @IsIn(CHANNELS, { each: true }) channels?: Channel[]
}

class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MinLength(1) title?: string
  @IsOptional() @IsString() @MinLength(1) body?: string
  @IsOptional() @IsBoolean() urgent?: boolean
}

/** Class ids whose announcements the user may read. */
export async function visibleClassIds(prisma: PrismaService, user: AuthUser): Promise<string[] | 'all'> {
  if (['principal', 'admin', 'clerk'].includes(user.role)) return 'all'
  const ids = new Set(user.classIds ?? [])
  if (user.role === 'parent' && user.linkedStudentIds?.length) {
    const ms = await prisma.classMember.findMany({ where: { userId: { in: user.linkedStudentIds } }, select: { classId: true } })
    ms.forEach((m) => ids.add(m.classId))
  }
  return [...ids]
}

@Controller('announcements')
@UseGuards(AuthGuard, PermissionGuard)
export class AnnouncementsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('classId') classId?: string) {
    const visible = await visibleClassIds(this.prisma, user)
    if (classId && visible !== 'all' && !visible.includes(classId)) throw new ForbiddenException()
    const where = classId
      ? { schoolId: user.schoolId, classId }
      : { schoolId: user.schoolId, OR: [{ classId: null }, ...(visible === 'all' ? [] : [{ classId: { in: visible } }])] }
    const rows = await this.prisma.announcement.findMany({
      where: visible === 'all' && !classId ? { schoolId: user.schoolId } : where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } })
    const m = new Map(authors.map((a) => [a.id, a.name]))
    return rows.map((r) => ({ ...r, authorName: m.get(r.authorId) ?? 'unknown', canModify: this.canModify(user, r) }))
  }

  /** Whether this person could post to that audience (a class, or the whole school). */
  private mayPost(user: AuthUser, classId: string | null) {
    return classId
      ? can(user, 'announcements', 'write', { classId }) || can(user, 'announcements', 'manage')
      : can(user, 'announcements', 'write') || can(user, 'announcements', 'manage')
  }

  /** The author (while they can still post there), and the principal and admin for anyone's. */
  private canModify(user: AuthUser, a: { authorId: string; classId: string | null }) {
    if (user.role === 'principal' || can(user, 'announcements', 'manage')) return true
    return a.authorId === user.id && this.mayPost(user, a.classId)
  }

  private async ownAnnouncement(user: AuthUser, id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!a) throw new NotFoundException()
    if (!this.canModify(user, a)) throw new ForbiddenException()
    return a
  }

  /** Fixes the wording. People are not sent it again, and it is marked "edited" so nobody is misled. */
  @Put(':id')
  async edit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    const a = await this.ownAnnouncement(user, id)
    const data: { title?: string; body?: string; urgent?: boolean } = {}
    if (dto.title !== undefined && dto.title.trim() !== a.title) data.title = dto.title.trim()
    if (dto.body !== undefined && dto.body.trim() !== a.body) data.body = dto.body.trim()
    if (dto.urgent !== undefined && dto.urgent !== a.urgent) data.urgent = dto.urgent
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException('The title cannot be empty')
    if (dto.body !== undefined && !dto.body.trim()) throw new BadRequestException('The message cannot be empty')
    if (!Object.keys(data).length) return { ...a, canModify: true }
    const upd = await this.prisma.announcement.update({ where: { id }, data: { ...data, editedAt: new Date() } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'announcement.edited', resource: 'announcement', resourceId: id, meta: { fields: Object.keys(data) } })
    return { ...upd, canModify: true }
  }

  /** Removes it for everyone. Messages already sent stay in inboxes; the audit log keeps the title. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.ownAnnouncement(user, id)
    await this.prisma.announcement.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'announcement.deleted', resource: 'announcement', resourceId: id, meta: { title: a.title, classId: a.classId } })
    return { ok: true }
  }

  @Post()
  async post(@CurrentUser() user: AuthUser, @Body() dto: PostAnnouncementDto) {
    const classId = dto.classId ?? null
    if (classId) {
      const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
      if (!cls) throw new ForbiddenException()
    }
    // Class-targeted posts are checked against the class; school-wide posts need school scope.
    const allowed = classId
      ? can(user, 'announcements', 'write', { classId }) || can(user, 'announcements', 'manage')
      : can(user, 'announcements', 'write') || can(user, 'announcements', 'manage')
    if (!allowed) throw new ForbiddenException()
    const a = await this.prisma.announcement.create({
      data: { schoolId: user.schoolId, classId, authorId: user.id, title: dto.title, body: dto.body, urgent: !!dto.urgent },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'announcement.posted', resource: 'announcement', resourceId: a.id })
    await this.bus.emit('announcement.posted', { schoolId: user.schoolId, classId, announcementId: a.id, title: a.title, body: a.body, urgent: a.urgent, channels: dto.channels ?? (a.urgent ? ['whatsapp', 'in_app'] : ['email', 'in_app']), actorId: user.id })
    return a
  }
}

@Module({ controllers: [AnnouncementsController] })
export class AnnouncementsModule {}
