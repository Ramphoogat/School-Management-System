import { Controller, ForbiddenException, Get, Injectable, Logger, Module, OnModuleInit, Param, Query, UseGuards } from '@nestjs/common'
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { EventBus } from '../events/events.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

const MAX_LEN = 2000

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  /** Class members (student, teacher) and school-wide chat roles (principal). */
  async assertAccess(user: AuthUser, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId }, select: { id: true } })
    if (!cls || !can(user, 'chat', 'write', { classId })) throw new ForbiddenException()
  }

  /** A custom text channel must belong to this class; no channelId means the class's main chat. */
  private async assertChannel(classId: string, channelId?: string) {
    if (!channelId) return null
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, classId, type: 'text' }, select: { id: true } })
    if (!ch) throw new ForbiddenException()
    return ch.id
  }

  async history(user: AuthUser, classId: string, before?: string, channelId?: string) {
    await this.assertAccess(user, classId)
    const channel = await this.assertChannel(classId, channelId)
    const rows = await this.prisma.chatMessage.findMany({
      where: { classId, channelId: channel, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return this.withNames(rows.reverse())
  }

  async post(user: AuthUser, classId: string, body: string, channelId?: string) {
    await this.assertAccess(user, classId)
    const channel = await this.assertChannel(classId, channelId)
    const text = body?.trim()
    if (!text) throw new ForbiddenException('Empty message')
    const m = await this.prisma.chatMessage.create({ data: { schoolId: user.schoolId, classId, channelId: channel, senderId: user.id, body: text.slice(0, MAX_LEN) } })
    return (await this.withNames([m]))[0]
  }

  /** The class's welcome to a newly admitted student, posted in the main chat under the name of whoever approved the admission. */
  async welcome(schoolId: string, classId: string, senderId: string, studentName: string) {
    const m = await this.prisma.chatMessage.create({ data: { schoolId, classId, channelId: null, senderId, body: `Welcome to the class, ${studentName}! We're glad you're here.` } })
    return (await this.withNames([m]))[0]
  }

  /** Everyone who belongs to the class, for the members panel. Presence is layered on by the client. */
  async members(user: AuthUser, classId: string) {
    await this.assertAccess(user, classId)
    const rows = await this.prisma.classMember.findMany({ where: { classId }, include: { user: { select: { id: true, name: true } } } })
    return rows.map((r) => ({ id: r.user.id, name: r.user.name, role: r.roleInClass }))
  }

  private async withNames<T extends { senderId: string }>(rows: T[]) {
    const us = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.senderId))] } }, select: { id: true, name: true, role: true } })
    const m = new Map(us.map((u) => [u.id, u]))
    return rows.map((r) => ({ ...r, senderName: m.get(r.senderId)?.name ?? 'unknown', senderRole: m.get(r.senderId)?.role }))
  }
}

@Controller('chat')
@UseGuards(AuthGuard, PermissionGuard)
export class ChatController {
  constructor(private chat: ChatService) {}

  @Get(':classId/members')
  members(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    return this.chat.members(user, classId)
  }

  @Get(':classId')
  history(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Query('before') before?: string, @Query('channelId') channelId?: string) {
    return this.chat.history(user, classId, before, channelId)
  }
}

/**
 * Real-time chat over Socket.IO. The client authenticates with its access token in the handshake;
 * every join and send re-checks class membership on the server.
 */
@WebSocketGateway({ cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private log = new Logger('ChatGateway')
  @WebSocketServer() server: Server

  /** Who is connected right now (in memory, single API instance). A user with `invisible` set appears offline to others. */
  private presence = new Map<string, { schoolId: string; sockets: Set<string>; invisible: boolean }>()

  constructor(private auth: AuthGuard, private chat: ChatService, private bus: EventBus) {}

  onModuleInit() {
    // A student joining the class is greeted in its main chat, live for anyone who has it open.
    this.bus.on('student.admitted', async (e) => {
      const msg = await this.chat.welcome(e.schoolId, e.classId, e.actorId, e.studentName)
      this.server?.to(`class:${e.classId}`).emit('message', msg)
    })
  }

  private visible(p?: { sockets: Set<string>; invisible: boolean }) {
    return !!p && p.sockets.size > 0 && !p.invisible
  }

  private emitPresence(userId: string, schoolId: string, online: boolean) {
    this.server.to(`school:${schoolId}`).emit('presence', { userId, online })
  }

  async handleConnection(socket: Socket) {
    let user: AuthUser
    try {
      user = await this.auth.authenticate(String(socket.handshake.auth?.token ?? ''))
      socket.data.user = user
    } catch {
      socket.emit('error_message', 'Unauthorized')
      socket.disconnect(true)
      return
    }
    await socket.join(`school:${user.schoolId}`)
    const p = this.presence.get(user.id) ?? { schoolId: user.schoolId, sockets: new Set<string>(), invisible: false }
    const before = this.visible(p)
    p.sockets.add(socket.id)
    // Only the app-wide connection sends a status; the chat connection must not reset it.
    if (socket.handshake.auth?.status) p.invisible = socket.handshake.auth.status === 'invisible'
    this.presence.set(user.id, p)
    const online = [...this.presence.entries()].filter(([, v]) => v.schoolId === user.schoolId && this.visible(v)).map(([id]) => id)
    socket.emit('presence_snapshot', { online })
    if (this.visible(p) !== before) this.emitPresence(user.id, user.schoolId, this.visible(p))
  }

  handleDisconnect(socket: Socket) {
    const user: AuthUser | undefined = socket.data.user
    const p = user && this.presence.get(user.id)
    if (!user || !p) return
    const before = this.visible(p)
    p.sockets.delete(socket.id)
    if (p.sockets.size === 0) this.presence.delete(user.id)
    if (before && !this.visible(p)) this.emitPresence(user.id, user.schoolId, false)
  }

  @SubscribeMessage('set_status')
  setStatus(@ConnectedSocket() socket: Socket, @MessageBody() data: { status: 'online' | 'invisible' }) {
    const user: AuthUser | undefined = socket.data.user
    const p = user && this.presence.get(user.id)
    if (!user || !p) return { ok: false }
    const before = this.visible(p)
    p.invisible = data?.status === 'invisible'
    if (this.visible(p) !== before) this.emitPresence(user.id, user.schoolId, this.visible(p))
    return { ok: true }
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() data: { classId: string }) {
    try {
      // Refresh scope so membership changes apply without reconnecting.
      const user: AuthUser = socket.data.user
      await this.chat.assertAccess(user, data.classId)
      await socket.join(`class:${data.classId}`)
      return { ok: true }
    } catch {
      return { ok: false, error: 'Not allowed' }
    }
  }

  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() data: { classId: string }) {
    await socket.leave(`class:${data.classId}`)
    return { ok: true }
  }

  @SubscribeMessage('message')
  async message(@ConnectedSocket() socket: Socket, @MessageBody() data: { classId: string; body: string; channelId?: string }) {
    try {
      const msg = await this.chat.post(socket.data.user, data.classId, data.body, data.channelId)
      this.server.to(`class:${data.classId}`).emit('message', msg)
      return { ok: true }
    } catch (e) {
      this.log.warn(`send rejected: ${(e as Error).message}`)
      return { ok: false, error: 'Message not sent' }
    }
  }
}

@Module({ providers: [ChatService, ChatGateway], controllers: [ChatController] })
export class ChatModule {}
