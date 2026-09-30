import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { Response } from 'express'
import { Server, Socket } from 'socket.io'
import { Prisma } from '@school/db'
import { roleCan } from '@school/permissions'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { ALLOWED_FILES_TEXT, MAX_FILE_BYTES, cleanName, judgeUpload, type Upload } from '../storage/upload-rules'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const MAX_BODY = 2000
const RATE_LIMIT = 30 // messages per person per minute
const EPOCH = new Date(0)

class StartDto {
  @IsString() userId: string
}
class SendDto {
  /** May be empty when files are attached. */
  @IsOptional() @IsString() @MaxLength(MAX_BODY) body?: string
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) attachmentIds?: string[]
  /** The child this message is about (needed from a parent with more than one child). */
  @IsOptional() @IsString() aboutStudentId?: string
}
class EditDto {
  @IsString() @MinLength(1) @MaxLength(MAX_BODY) body: string
}
class BlockDto {
  @IsString() userId: string
}
class ReportDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string
  @IsOptional() @IsString() messageId?: string
}
class ReviewDto {
  @IsIn(['reviewed', 'dismissed']) status: 'reviewed' | 'dismissed'
  @IsOptional() @IsString() @MaxLength(1000) note?: string
}

/** Unread direct messages for one person, across all their conversations. */
export async function unreadMessages(prisma: PrismaService, userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    select count(*)::bigint as n
    from "DirectMessage" m
    join "Conversation" c on c."id" = m."conversationId"
    left join "ConversationRead" r on r."conversationId" = c."id" and r."userId" = ${userId}
    where (c."userAId" = ${userId} or c."userBId" = ${userId})
      and m."senderId" <> ${userId}
      and m."deletedAt" is null
      and (r."readAt" is null or m."createdAt" > r."readAt")`)
  return Number(rows[0]?.n ?? 0)
}

type Person = { id: string; name: string; role: string; schoolId: string; active: boolean }

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  // ---- who may message whom ----------------------------------------------------------------
  //   principal  -> everyone except admin        clerk    -> parents, students, teachers, principal
  //   teacher    -> their students, those students' parents, principal, clerk
  //   student    -> teachers of their classes    parent   -> teachers of their children's classes
  //   admin      -> nobody
  // A conversation can be started by one side only if that side is allowed above. Once it exists, either
  // person can reply as long as the relationship still holds (for example the parent link is still approved).

  /** Classes a teacher teaches: as a class member with the teacher role, or through the timetable. */
  private async teacherClassIds(teacherId: string): Promise<string[]> {
    const [members, slots] = await Promise.all([
      this.prisma.classMember.findMany({ where: { userId: teacherId, roleInClass: 'teacher' }, select: { classId: true } }),
      this.prisma.timetableSlot.findMany({ where: { teacherId }, select: { classId: true }, distinct: ['classId'] }),
    ])
    return [...new Set([...members.map((m) => m.classId), ...slots.map((s) => s.classId)])]
  }

  private async teaches(teacherId: string, classIds: string[]): Promise<boolean> {
    if (!classIds.length) return false
    const mine = await this.teacherClassIds(teacherId)
    return mine.some((c) => classIds.includes(c))
  }

  private async classIdsOfStudents(studentIds: string[]): Promise<string[]> {
    if (!studentIds.length) return []
    const m = await this.prisma.classMember.findMany({ where: { userId: { in: studentIds } }, select: { classId: true } })
    return [...new Set(m.map((x) => x.classId))]
  }

  async canStart(from: AuthUser, to: Person): Promise<boolean> {
    if (from.id === to.id || from.schoolId !== to.schoolId || !to.active) return false
    switch (from.role) {
      case 'principal': return to.role !== 'admin'
      case 'clerk': return ['parent', 'student', 'teacher', 'principal'].includes(to.role)
      case 'student': return to.role === 'teacher' && this.teaches(to.id, from.classIds ?? [])
      case 'parent': return to.role === 'teacher' && this.teaches(to.id, await this.classIdsOfStudents(from.linkedStudentIds ?? []))
      case 'teacher': {
        if (to.role === 'principal' || to.role === 'clerk') return true
        const mine = await this.teacherClassIds(from.id)
        if (to.role === 'student') return (await this.classIdsOfStudents([to.id])).some((c) => mine.includes(c))
        if (to.role === 'parent') {
          const kids = await this.prisma.parentStudentLink.findMany({ where: { parentId: to.id, status: 'approved' }, select: { studentId: true } })
          return (await this.classIdsOfStudents(kids.map((k) => k.studentId))).some((c) => mine.includes(c))
        }
        return false
      }
      default: return false
    }
  }

  /** Both people may keep talking while either could have started the conversation. */
  async canConverse(me: AuthUser, other: Person, other_as_actor: AuthUser | null): Promise<boolean> {
    if (await this.canStart(me, other)) return true
    return other_as_actor ? this.canStart(other_as_actor, { id: me.id, name: me.name, role: me.role, schoolId: me.schoolId, active: true }) : false
  }

  /** The other person, loaded with the scope information the rules need. */
  async asActor(userId: string): Promise<AuthUser | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { select: { classId: true } }, asParent: { where: { status: 'approved' }, select: { studentId: true } } },
    })
    if (!u || !u.active) return null
    return { id: u.id, role: u.role, schoolId: u.schoolId, email: u.email, name: u.name, classIds: u.memberships.map((m) => m.classId), linkedStudentIds: u.asParent.map((l) => l.studentId) }
  }

  async canConverseWith(me: AuthUser, otherId: string): Promise<{ ok: boolean; other?: AuthUser }> {
    const other = await this.asActor(otherId)
    if (!other || other.schoolId !== me.schoolId) return { ok: false }
    if (await this.blockedBetween(me.id, otherId)) return { ok: false, other }
    const p: Person = { id: other.id, name: other.name, role: other.role, schoolId: other.schoolId, active: true }
    return { ok: await this.canConverse(me, p, other), other }
  }

  // ---- contacts ------------------------------------------------------------------------------

  /** People this user can start a conversation with, with a short description of why (class, child). */
  async contacts(me: AuthUser, q: string): Promise<{ id: string; name: string; role: string; context: string }[]> {
    const search = q.trim()
    const nameFilter: Prisma.UserWhereInput = search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}
    const base: Prisma.UserWhereInput = { schoolId: me.schoolId, active: true, id: { not: me.id }, ...nameFilter }
    let users: { id: string; name: string; role: string }[] = []

    if (me.role === 'principal') {
      users = await this.prisma.user.findMany({ where: { ...base, role: { not: 'admin' } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' }, take: 50 })
    } else if (me.role === 'clerk') {
      users = await this.prisma.user.findMany({ where: { ...base, role: { in: ['parent', 'student', 'teacher', 'principal'] } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' }, take: 50 })
    } else if (me.role === 'student' || me.role === 'parent') {
      const classIds = me.role === 'student' ? me.classIds ?? [] : await this.classIdsOfStudents(me.linkedStudentIds ?? [])
      const [members, slots] = await Promise.all([
        this.prisma.classMember.findMany({ where: { classId: { in: classIds }, roleInClass: 'teacher' }, select: { userId: true } }),
        this.prisma.timetableSlot.findMany({ where: { classId: { in: classIds }, teacherId: { not: null } }, select: { teacherId: true } }),
      ])
      const ids = [...new Set([...members.map((m) => m.userId), ...slots.map((s) => s.teacherId!)])]
      users = await this.prisma.user.findMany({ where: { ...base, id: { in: ids, not: me.id }, role: 'teacher' }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' }, take: 50 })
    } else if (me.role === 'teacher') {
      const mine = await this.teacherClassIds(me.id)
      const students = await this.prisma.classMember.findMany({ where: { classId: { in: mine }, roleInClass: 'student' }, select: { userId: true } })
      const studentIds = [...new Set(students.map((s) => s.userId))]
      const parents = await this.prisma.parentStudentLink.findMany({ where: { studentId: { in: studentIds }, status: 'approved' }, select: { parentId: true } })
      const ids = [...new Set([...studentIds, ...parents.map((p) => p.parentId)])]
      users = await this.prisma.user.findMany({
        where: { ...base, OR: [{ id: { in: ids } }, { role: { in: ['principal', 'clerk'] } }] },
        select: { id: true, name: true, role: true }, orderBy: { name: 'asc' }, take: 50,
      })
    }
    const blocks = users.length
      ? await this.prisma.messageBlock.findMany({ where: { OR: [{ blockerId: me.id, blockedId: { in: users.map((u) => u.id) } }, { blockedId: me.id, blockerId: { in: users.map((u) => u.id) } }] } })
      : []
    const hidden = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]))
    return this.describe(users.filter((u) => !hidden.has(u.id)))
  }

  /** "Teacher · Grade 8-A", "Parent of Asha Rao", "Student · Grade 8-A". */
  async describe<T extends { id: string; name: string; role: string }>(users: T[]): Promise<(T & { context: string })[]> {
    if (!users.length) return []
    const ids = users.map((u) => u.id)
    const [members, slots, links] = await Promise.all([
      this.prisma.classMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, class: { select: { name: true } } } }),
      this.prisma.timetableSlot.findMany({ where: { teacherId: { in: ids } }, select: { teacherId: true, classId: true } }),
      this.prisma.parentStudentLink.findMany({ where: { parentId: { in: ids }, status: 'approved' }, select: { parentId: true, student: { select: { name: true } } } }),
    ])
    const slotClasses = await this.prisma.class.findMany({ where: { id: { in: [...new Set(slots.map((s) => s.classId))] } }, select: { id: true, name: true } })
    const cname = new Map(slotClasses.map((c) => [c.id, c.name]))
    return users.map((u) => {
      const classes = new Set<string>(members.filter((m) => m.userId === u.id).map((m) => m.class.name))
      if (u.role === 'teacher') for (const s of slots.filter((x) => x.teacherId === u.id)) { const n = cname.get(s.classId); if (n) classes.add(n) }
      const kids = links.filter((l) => l.parentId === u.id).map((l) => l.student.name)
      const context = u.role === 'parent' ? (kids.length ? `Parent of ${kids.join(', ')}` : 'Parent')
        : u.role === 'student' ? `Student${classes.size ? ` · ${[...classes].join(', ')}` : ''}`
        : u.role === 'teacher' ? `Teacher${classes.size ? ` · ${[...classes].join(', ')}` : ''}`
        : u.role[0].toUpperCase() + u.role.slice(1)
      return { ...u, context }
    })
  }

  async blockedBetween(a: string, b: string) {
    return !!(await this.prisma.messageBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { id: true } }))
  }

  /** The children of the parent in a conversation (whichever side they are on), so a message can say who it is about. */
  async childrenFor(me: AuthUser, otherRole: string, otherId: string): Promise<{ id: string; name: string }[]> {
    const parentId = me.role === 'parent' ? me.id : otherRole === 'parent' ? otherId : null
    if (!parentId) return []
    const links = await this.prisma.parentStudentLink.findMany({ where: { parentId, status: 'approved' }, select: { student: { select: { id: true, name: true } } } })
    return links.map((l) => l.student)
  }

  /**
   * Which child a message is about. A parent with one child is tagged automatically; with several they must choose.
   * A teacher writing to a parent may tag one too. The child has to be one of that parent's approved children.
   */
  async resolveAbout(sender: AuthUser, other: AuthUser, aboutStudentId?: string): Promise<string | null> {
    const parent = sender.role === 'parent' ? sender : other.role === 'parent' ? other : null
    if (!parent) {
      if (aboutStudentId) throw new BadRequestException('Only messages with a parent can be about a child')
      return null
    }
    const kids = parent.linkedStudentIds ?? []
    if (aboutStudentId) {
      if (!kids.includes(aboutStudentId)) throw new BadRequestException('That child is not linked to this parent')
      return aboutStudentId
    }
    if (sender.role !== 'parent') return null
    if (kids.length === 1) return kids[0]
    if (kids.length > 1) throw new BadRequestException('Choose which child this message is about')
    return null
  }

  /**
   * Who may read a reported conversation: the principal, for anyone except themselves; and the admin, only when the
   * principal is one of the two people, so nobody reviews a complaint about themselves. Never a participant.
   */
  async mayReview(user: AuthUser, c: { userAId: string; userBId: string }): Promise<boolean> {
    if (c.userAId === user.id || c.userBId === user.id) return false
    const people = await this.prisma.user.findMany({ where: { id: { in: [c.userAId, c.userBId] } }, select: { role: true } })
    const principalInvolved = people.some((p) => p.role === 'principal')
    return user.role === 'admin' ? principalInvolved : user.role === 'principal' ? !principalInvolved : false
  }

  static pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }
}

/** Live delivery: every connection joins a private room named after the person. */
@WebSocketGateway({ cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true } })
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server
  private typedAt = new Map<string, number>()
  constructor(private auth: AuthGuard, private prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    try {
      const user: AuthUser = (socket.data.user ??= await this.auth.authenticate(String(socket.handshake.auth?.token ?? '')))
      await socket.join(`user:${user.id}`)
    } catch {
      socket.disconnect(true)
    }
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload)
  }

  /** Whether the person has the app open right now (any tab or device). */
  async isOnline(userId: string) {
    const sockets = await this.server?.in(`user:${userId}`).fetchSockets()
    return (sockets?.length ?? 0) > 0
  }

  /** "Is typing…": only ever passed to the other person in that conversation, and at most once a second per person. */
  @SubscribeMessage('dm:typing')
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() data: { conversationId?: string }) {
    const user: AuthUser | undefined = socket.data.user
    if (!user || !data?.conversationId) return
    const now = Date.now()
    if (now - (this.typedAt.get(user.id) ?? 0) < 1000) return
    this.typedAt.set(user.id, now)
    const c = await this.prisma.conversation.findFirst({ where: { id: data.conversationId, schoolId: user.schoolId, OR: [{ userAId: user.id }, { userBId: user.id }] }, select: { userAId: true, userBId: true } })
    if (!c) return
    this.toUser(c.userAId === user.id ? c.userBId : c.userAId, 'dm:typing', { conversationId: data.conversationId, userId: user.id, name: user.name })
  }
}

const EDIT_WINDOW_MS = 15 * 60_000
const MAX_ATTACHMENTS = 5

type MessageRow = { id: string; conversationId: string; senderId: string; body: string; createdAt: Date; editedAt: Date | null; deletedAt: Date | null; aboutStudentId: string | null }

@Controller('messages')
@UseGuards(AuthGuard, PermissionGuard)
export class MessagesController {
  private sent = new Map<string, number[]>()

  constructor(private prisma: PrismaService, private svc: MessagesService, private audit: AuditService, private bus: EventBus, private gw: MessagesGateway) {}

  private async mine(user: AuthUser, id: string) {
    const c = await this.prisma.conversation.findFirst({ where: { id, schoolId: user.schoolId, OR: [{ userAId: user.id }, { userBId: user.id }] } })
    if (!c) throw new NotFoundException()
    return c
  }
  private otherId = (c: { userAId: string; userBId: string }, me: string) => (c.userAId === me ? c.userBId : c.userAId)

  /** Messages as the client sees them: deleted ones are only a placeholder, files and the child a message is about are attached. */
  private async present(me: string, rows: MessageRow[]) {
    const ids = rows.map((r) => r.id)
    const [files, kids] = await Promise.all([
      ids.length ? this.prisma.dmAttachment.findMany({ where: { messageId: { in: ids } }, orderBy: { createdAt: 'asc' } }) : [],
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.aboutStudentId).filter(Boolean) as string[])] } }, select: { id: true, name: true } }),
    ])
    const kid = new Map(kids.map((k) => [k.id, k.name]))
    return rows.map((m) => ({
      id: m.id,
      body: m.deletedAt ? '' : m.body,
      deleted: !!m.deletedAt,
      edited: !!m.editedAt && !m.deletedAt,
      mine: m.senderId === me,
      senderId: m.senderId,
      createdAt: m.createdAt,
      about: m.aboutStudentId ? { id: m.aboutStudentId, name: kid.get(m.aboutStudentId) ?? 'Student' } : null,
      attachments: m.deletedAt ? [] : files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime })),
    }))
  }

  /** While a report is open the conversation is frozen for editing and deleting, so nothing can be tampered with. */
  private async underReview(conversationId: string) {
    return !!(await this.prisma.messageReport.findFirst({ where: { conversationId, status: 'open' }, select: { id: true } }))
  }

  private brake(userId: string) {
    const now = Date.now()
    const recent = (this.sent.get(userId) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= RATE_LIMIT) throw new HttpException('You are sending messages too quickly. Wait a moment.', HttpStatus.TOO_MANY_REQUESTS)
    this.sent.set(userId, [...recent, now])
  }

  @Get('contacts')
  @RequirePermission('messages', 'write')
  contacts(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.svc.contacts(user, q)
  }

  @Get('unread')
  @RequirePermission('messages', 'write')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await unreadMessages(this.prisma, user.id) }
  }

  @Get('conversations')
  @RequirePermission('messages', 'write')
  async list(@CurrentUser() user: AuthUser) {
    const convs = await this.prisma.conversation.findMany({
      where: { schoolId: user.schoolId, OR: [{ userAId: user.id }, { userBId: user.id }] },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: { reads: { where: { userId: user.id } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { _count: { select: { attachments: true } } } } },
    })
    const others = await this.prisma.user.findMany({ where: { id: { in: convs.map((c) => this.otherId(c, user.id)) } }, select: { id: true, name: true, role: true } })
    const described = new Map((await this.svc.describe(others)).map((o) => [o.id, o]))
    const unread = await Promise.all(convs.map((c) => this.prisma.directMessage.count({ where: { conversationId: c.id, senderId: { not: user.id }, deletedAt: null, createdAt: { gt: c.reads[0]?.readAt ?? EPOCH } } })))
    return convs.map((c, i) => {
      const o = described.get(this.otherId(c, user.id))
      const last = c.messages[0]
      const preview = !last ? '' : last.deletedAt ? 'Message deleted' : last.body ? last.body.slice(0, 120) : last._count.attachments ? 'Attachment' : ''
      return { id: c.id, other: o ?? { id: this.otherId(c, user.id), name: 'Former user', role: '', context: '' }, lastMessage: last ? { body: preview, mine: last.senderId === user.id, createdAt: last.createdAt } : null, lastMessageAt: c.lastMessageAt, unread: unread[i] }
    })
  }

  /** Open (or create) the conversation with someone. Starting one needs the rules above. */
  @Post('conversations')
  @RequirePermission('messages', 'write')
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    const [a, b] = MessagesService.pair(user.id, dto.userId)
    const existing = await this.prisma.conversation.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } })
    if (existing && existing.schoolId === user.schoolId) return { id: existing.id, created: false }
    const target = await this.prisma.user.findFirst({ where: { id: dto.userId, schoolId: user.schoolId, active: true }, select: { id: true, name: true, role: true, schoolId: true, active: true } })
    if (!target || (await this.svc.blockedBetween(user.id, target.id)) || !(await this.svc.canStart(user, target))) throw new ForbiddenException('You cannot message this person')
    const c = await this.prisma.conversation.create({ data: { schoolId: user.schoolId, userAId: a, userBId: b } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.conversation_started', resource: 'conversation', resourceId: c.id, meta: { with: target.id } })
    return { id: c.id, created: true }
  }

  @Get('conversations/:id')
  @RequirePermission('messages', 'write')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('before') before?: string) {
    const c = await this.mine(user, id)
    const otherId = this.otherId(c, user.id)
    const rows = await this.prisma.directMessage.findMany({ where: { conversationId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 })
    const readAt = new Date()
    await this.prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, update: { readAt }, create: { conversationId: id, userId: user.id } })
    this.gw.toUser(otherId, 'dm:read', { conversationId: id, readAt })
    const [other] = await this.svc.describe(await this.prisma.user.findMany({ where: { id: otherId }, select: { id: true, name: true, role: true } }))
    const { ok } = await this.svc.canConverseWith(user, otherId)
    const [theirRead, iBlocked, reported, kids] = await Promise.all([
      this.prisma.conversationRead.findUnique({ where: { conversationId_userId: { conversationId: id, userId: otherId } } }),
      this.prisma.messageBlock.findUnique({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: otherId } } }),
      this.underReview(id),
      this.svc.childrenFor(user, other?.role ?? '', otherId),
    ])
    return {
      id,
      other: other ?? { id: otherId, name: 'Former user', role: '', context: '' },
      canReply: ok,
      blockedByMe: !!iBlocked,
      reported,
      otherReadAt: theirRead?.readAt ?? null,
      kids,
      messages: await this.present(user.id, rows.reverse()),
    }
  }

  @Post('conversations/:id/read')
  @RequirePermission('messages', 'write')
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.mine(user, id)
    const readAt = new Date()
    await this.prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, update: { readAt }, create: { conversationId: id, userId: user.id } })
    this.gw.toUser(this.otherId(c, user.id), 'dm:read', { conversationId: id, readAt })
    return { ok: true }
  }

  // ---- attachments ----------------------------------------------------------------------------

  /** Upload a file for the next message. It stays private to the conversation and is not shown until the message is sent. */
  @Post('conversations/:id/attachments')
  @RequirePermission('messages', 'write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async attach(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file: Upload | undefined) {
    const c = await this.mine(user, id)
    const { ok } = await this.svc.canConverseWith(user, this.otherId(c, user.id))
    if (!ok) throw new ForbiddenException('You can no longer message this person')
    if (!file) throw new BadRequestException('Choose a file (max 10 MB)')
    const type = judgeUpload(file)
    if (!type) throw new BadRequestException(`Allowed files: ${ALLOWED_FILES_TEXT}`)

    // Tidy up this person's abandoned uploads (chosen but never sent), then cap how many can be waiting.
    const stale = await this.prisma.dmAttachment.findMany({ where: { uploaderId: user.id, messageId: null, createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } })
    for (const s of stale) { await deleteFile(s.storageKey); await this.prisma.dmAttachment.delete({ where: { id: s.id } }) }
    if ((await this.prisma.dmAttachment.count({ where: { conversationId: id, uploaderId: user.id, messageId: null } })) >= MAX_ATTACHMENTS) throw new BadRequestException(`At most ${MAX_ATTACHMENTS} files per message`)

    const storageKey = newKey()
    await putFile(storageKey, file.buffer)
    try {
      const row = await this.prisma.dmAttachment.create({ data: { schoolId: user.schoolId, conversationId: id, uploaderId: user.id, name: cleanName(file.originalname), mime: type.mime, size: file.size, storageKey } })
      return { id: row.id, name: row.name, size: row.size, mime: row.mime }
    } catch (e) {
      await deleteFile(storageKey)
      throw e
    }
  }

  /** Take back a file that was uploaded but not yet sent. */
  @Delete('attachments/:attachmentId')
  @RequirePermission('messages', 'write')
  async dropAttachment(@CurrentUser() user: AuthUser, @Param('attachmentId') attachmentId: string) {
    const f = await this.prisma.dmAttachment.findFirst({ where: { id: attachmentId, schoolId: user.schoolId, uploaderId: user.id, messageId: null } })
    if (!f) throw new NotFoundException()
    await deleteFile(f.storageKey)
    await this.prisma.dmAttachment.delete({ where: { id: f.id } })
    return { ok: true }
  }

  /** The two people in the conversation can download its files. A reviewer can too, but only for a conversation they may review, and it is recorded. */
  @Get('attachments/:attachmentId')
  async download(@CurrentUser() user: AuthUser, @Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const f = await this.prisma.dmAttachment.findFirst({ where: { id: attachmentId, schoolId: user.schoolId } })
    if (!f || !f.messageId) throw new NotFoundException()
    const c = await this.prisma.conversation.findUnique({ where: { id: f.conversationId } })
    if (!c) throw new NotFoundException()
    const participant = c.userAId === user.id || c.userBId === user.id
    if (!participant) {
      const reviewer = roleCan(user.role, 'messages', 'moderate') && (await this.svc.mayReview(user, c)) && (await this.prisma.messageReport.findFirst({ where: { conversationId: c.id }, select: { id: true } }))
      if (!reviewer) throw new NotFoundException()
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.attachment_viewed', resource: 'conversation', resourceId: c.id, meta: { attachmentId } })
    }
    const data = await getFile(f.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('File is missing from storage')
    res.set({ 'Content-Type': f.mime, 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' })
    res.end(data)
  }

  // ---- sending, editing, deleting -------------------------------------------------------------

  @Post('conversations/:id')
  @RequirePermission('messages', 'write')
  async send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendDto) {
    const body = (dto.body ?? '').trim()
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])]
    if (!body && attachmentIds.length === 0) throw new BadRequestException('Write a message or attach a file first')
    const c = await this.mine(user, id)
    const otherId = this.otherId(c, user.id)

    const { ok, other } = await this.svc.canConverseWith(user, otherId)
    if (!ok || !other) throw new ForbiddenException('You can no longer message this person')

    const files = attachmentIds.length ? await this.prisma.dmAttachment.findMany({ where: { id: { in: attachmentIds }, conversationId: id, uploaderId: user.id, messageId: null } }) : []
    if (files.length !== attachmentIds.length) throw new BadRequestException('One of the files is no longer available. Attach it again.')
    const aboutStudentId = await this.svc.resolveAbout(user, other, dto.aboutStudentId)

    this.brake(user.id)

    const m = await this.prisma.directMessage.create({ data: { conversationId: id, senderId: user.id, body, aboutStudentId } })
    if (files.length) await this.prisma.dmAttachment.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { messageId: m.id } })
    await this.prisma.conversation.update({ where: { id }, data: { lastMessageAt: m.createdAt } })
    await this.prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, update: { readAt: m.createdAt }, create: { conversationId: id, userId: user.id, readAt: m.createdAt } })

    const [mine] = await this.present(user.id, [m])
    const theirs = { ...mine, mine: false }
    this.gw.toUser(otherId, 'dm:message', { conversationId: id, message: { ...theirs, senderId: user.id }, from: { id: user.id, name: user.name, role: user.role } })
    this.gw.toUser(user.id, 'dm:message', { conversationId: id, message: { ...mine, senderId: user.id }, from: { id: user.id, name: user.name, role: user.role } }) // other tabs and devices of the sender
    await this.bus.emit('dm.received', { schoolId: user.schoolId, conversationId: id, recipientId: otherId, senderId: user.id, senderName: user.name, body, attachments: files.length, recipientOnline: await this.gw.isOnline(otherId) })
    return mine
  }

  private async ownMessage(user: AuthUser, messageId: string) {
    const m = await this.prisma.directMessage.findUnique({ where: { id: messageId }, include: { conversation: true } })
    if (!m || m.conversation.schoolId !== user.schoolId || (m.conversation.userAId !== user.id && m.conversation.userBId !== user.id)) throw new NotFoundException()
    if (m.senderId !== user.id) throw new ForbiddenException('You can only change your own messages')
    if (m.deletedAt) throw new BadRequestException('This message was deleted')
    if (await this.underReview(m.conversationId)) throw new ForbiddenException('This conversation is under review, so its messages cannot be changed right now')
    return m
  }

  /** The sender can fix a message for 15 minutes. It is marked "edited" so nobody is misled. */
  @Put('message/:messageId')
  @RequirePermission('messages', 'write')
  async edit(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string, @Body() dto: EditDto) {
    const m = await this.ownMessage(user, messageId)
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw new ForbiddenException('Messages can only be edited for 15 minutes after sending')
    const body = dto.body.trim()
    if (!body) throw new BadRequestException('A message cannot be empty. Delete it instead.')
    if (body === m.body) return (await this.present(user.id, [m]))[0]
    const upd = await this.prisma.directMessage.update({ where: { id: messageId }, data: { body, editedAt: new Date() } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.edited', resource: 'conversation', resourceId: m.conversationId, meta: { messageId } })
    const otherId = this.otherId(m.conversation, user.id)
    const [mine] = await this.present(user.id, [upd])
    this.gw.toUser(user.id, 'dm:updated', { conversationId: m.conversationId, message: { ...mine, senderId: user.id } })
    this.gw.toUser(otherId, 'dm:updated', { conversationId: m.conversationId, message: { ...mine, mine: false, senderId: user.id } })
    return mine
  }

  /** The sender can delete a message any time. The text and files are erased and a "deleted" placeholder stays. */
  @Delete('message/:messageId')
  @RequirePermission('messages', 'write')
  async remove(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string) {
    const m = await this.ownMessage(user, messageId)
    const files = await this.prisma.dmAttachment.findMany({ where: { messageId } })
    await this.prisma.$transaction([
      this.prisma.dmAttachment.deleteMany({ where: { messageId } }),
      this.prisma.directMessage.update({ where: { id: messageId }, data: { body: '', deletedAt: new Date() } }),
    ])
    for (const f of files) await deleteFile(f.storageKey)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.deleted', resource: 'conversation', resourceId: m.conversationId, meta: { messageId } })
    const payload = { conversationId: m.conversationId, messageId }
    this.gw.toUser(user.id, 'dm:deleted', payload)
    this.gw.toUser(this.otherId(m.conversation, user.id), 'dm:deleted', payload)
    return { ok: true }
  }

  // ---- blocking ---------------------------------------------------------------------------------

  @Get('blocks')
  @RequirePermission('messages', 'write')
  async blocks(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.messageBlock.findMany({ where: { blockerId: user.id }, orderBy: { createdAt: 'desc' } })
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.blockedId) } }, select: { id: true, name: true, role: true } })
    return users
  }

  /** Stops them messaging you, and you messaging them, until you unblock. The school's leaders cannot be blocked. */
  @Post('blocks')
  @RequirePermission('messages', 'write')
  async block(@CurrentUser() user: AuthUser, @Body() dto: BlockDto) {
    if (dto.userId === user.id) throw new BadRequestException('You cannot block yourself')
    const target = await this.prisma.user.findFirst({ where: { id: dto.userId, schoolId: user.schoolId }, select: { id: true, role: true } })
    if (!target) throw new NotFoundException()
    if (target.role === 'principal' || target.role === 'admin') throw new ForbiddenException('The principal and admin cannot be blocked. Use Report if there is a problem.')
    await this.prisma.messageBlock.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: target.id } }, update: {}, create: { schoolId: user.schoolId, blockerId: user.id, blockedId: target.id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.blocked', resource: 'user', resourceId: target.id })
    return { ok: true }
  }

  @Delete('blocks/:userId')
  @RequirePermission('messages', 'write')
  async unblock(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    await this.prisma.messageBlock.deleteMany({ where: { blockerId: user.id, blockedId: userId } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.unblocked', resource: 'user', resourceId: userId })
    return { ok: true }
  }

  // ---- reporting and review ---------------------------------------------------------------------

  /** Filing a report is what lets the school read this one conversation. The other person is not told who reported. */
  @Post('conversations/:id/report')
  @RequirePermission('messages', 'write')
  async report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReportDto) {
    const c = await this.mine(user, id)
    const otherId = this.otherId(c, user.id)
    if (dto.messageId) {
      const m = await this.prisma.directMessage.findFirst({ where: { id: dto.messageId, conversationId: id } })
      if (!m) throw new NotFoundException('Message not found')
    }
    if (await this.prisma.messageReport.findFirst({ where: { conversationId: id, reporterId: user.id, status: 'open' } })) throw new BadRequestException('You have already reported this conversation. The school will review it.')
    const r = await this.prisma.messageReport.create({ data: { schoolId: user.schoolId, conversationId: id, messageId: dto.messageId ?? null, reporterId: user.id, reportedUserId: otherId, reason: dto.reason.trim() } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.reported', resource: 'conversation', resourceId: id, meta: { reportId: r.id } })
    await this.bus.emit('dm.reported', { schoolId: user.schoolId, reportId: r.id, conversationId: id, reporterId: user.id, participantIds: [c.userAId, c.userBId] })
    return { id: r.id }
  }

  private async visibleReports(user: AuthUser, status?: string) {
    const rows = await this.prisma.messageReport.findMany({ where: { schoolId: user.schoolId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 })
    const convs = await this.prisma.conversation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.conversationId))] } } })
    const cmap = new Map(convs.map((c) => [c.id, c]))
    const out: typeof rows = []
    for (const r of rows) { const c = cmap.get(r.conversationId); if (c && (await this.svc.mayReview(user, c))) out.push(r) }
    return out
  }

  @Get('reports')
  @RequirePermission('messages', 'moderate')
  async reports(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const rows = await this.visibleReports(user, status && ['open', 'reviewed', 'dismissed'].includes(status) ? status : undefined)
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.reporterId, r.reportedUserId, r.reviewedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true, role: true } })
    const p = new Map(people.map((x) => [x.id, x]))
    return rows.map((r) => ({ id: r.id, status: r.status, reason: r.reason, createdAt: r.createdAt, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewedBy: r.reviewedById ? p.get(r.reviewedById)?.name ?? null : null, reporter: p.get(r.reporterId) ?? null, reported: p.get(r.reportedUserId) ?? null, aboutMessage: !!r.messageId }))
  }

  /** Opens one reported conversation. Reading it is recorded in the audit log. */
  @Get('reports/:reportId')
  @RequirePermission('messages', 'moderate')
  async reportDetail(@CurrentUser() user: AuthUser, @Param('reportId') reportId: string) {
    const r = await this.prisma.messageReport.findFirst({ where: { id: reportId, schoolId: user.schoolId } })
    const c = r && (await this.prisma.conversation.findUnique({ where: { id: r.conversationId } }))
    if (!r || !c || !(await this.svc.mayReview(user, c))) throw new NotFoundException()
    const rows = await this.prisma.directMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, take: 300 })
    const people = await this.prisma.user.findMany({ where: { id: { in: [c.userAId, c.userBId, r.reporterId, r.reportedUserId] } }, select: { id: true, name: true, role: true } })
    const p = new Map(people.map((x) => [x.id, x]))
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'message.report_viewed', resource: 'conversation', resourceId: c.id, meta: { reportId } })
    const presented = await this.present('', rows.reverse())
    return {
      id: r.id, status: r.status, reason: r.reason, createdAt: r.createdAt, reviewNote: r.reviewNote, flaggedMessageId: r.messageId,
      reporter: p.get(r.reporterId) ?? null, reported: p.get(r.reportedUserId) ?? null,
      participants: [c.userAId, c.userBId].map((id) => p.get(id)).filter(Boolean),
      messages: presented.map((m) => ({ ...m, senderName: p.get(m.senderId)?.name ?? 'Former user', senderRole: p.get(m.senderId)?.role ?? '' })),
    }
  }

  @Put('reports/:reportId')
  @RequirePermission('messages', 'moderate')
  async review(@CurrentUser() user: AuthUser, @Param('reportId') reportId: string, @Body() dto: ReviewDto) {
    const r = await this.prisma.messageReport.findFirst({ where: { id: reportId, schoolId: user.schoolId } })
    const c = r && (await this.prisma.conversation.findUnique({ where: { id: r.conversationId } }))
    if (!r || !c || !(await this.svc.mayReview(user, c))) throw new NotFoundException()
    if (r.status !== 'open') throw new BadRequestException(`Already ${r.status}`)
    await this.prisma.messageReport.update({ where: { id: reportId }, data: { status: dto.status, reviewNote: dto.note?.trim() || null, reviewedById: user.id, reviewedAt: new Date() } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: `message.report_${dto.status}`, resource: 'conversation', resourceId: c.id, meta: { reportId } })
    await this.bus.emit('dm.report_reviewed', { schoolId: user.schoolId, reportId, reporterId: r.reporterId, status: dto.status, note: dto.note?.trim() || null })
    return { id: reportId, status: dto.status }
  }
}

@Module({ providers: [MessagesService, MessagesGateway], controllers: [MessagesController], exports: [MessagesService] })
export class MessagesModule {}
