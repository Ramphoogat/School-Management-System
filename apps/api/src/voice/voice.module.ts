import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { Server, Socket } from 'socket.io'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

/** Peer-to-peer (mesh) calls send one stream to every other person, so the room size is capped. */
export const MAX_PARTICIPANTS = 8
/** How long a person removed from a call cannot come straight back into that channel. */
export const REMOVAL_MINUTES = 5
const MAX_NOTE = 20_000

class CreateChannelDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string
}
class NoteDto {
  @IsString() @MaxLength(MAX_NOTE) body: string
}

export interface PeerState { mic: boolean; camera: boolean; screenStreamId: string | null }
interface Peer { socketId: string; userId: string; name: string; role: string; state: PeerState }

/** Who is in which call right now. Calls are live-only, so this lives in memory. */
@Injectable()
export class VoiceRooms {
  private rooms = new Map<string, Map<string, Peer>>()
  private removed = new Map<string, Map<string, number>>() // channel -> user -> time they may return
  ban(channelId: string, userId: string, until: number) { (this.removed.get(channelId) ?? this.removed.set(channelId, new Map()).get(channelId)!).set(userId, until) }
  banned(channelId: string, userId: string, now = Date.now()) {
    const until = this.removed.get(channelId)?.get(userId)
    if (until === undefined) return false
    if (until <= now) { this.removed.get(channelId)?.delete(userId); return false }
    return true
  }
  peers(channelId: string) { return [...(this.rooms.get(channelId)?.values() ?? [])] }
  count(channelId: string) { return this.rooms.get(channelId)?.size ?? 0 }
  has(channelId: string, socketId: string) { return !!this.rooms.get(channelId)?.has(socketId) }
  add(channelId: string, p: Peer) { (this.rooms.get(channelId) ?? this.rooms.set(channelId, new Map()).get(channelId)!).set(p.socketId, p) }
  get(channelId: string, socketId: string) { return this.rooms.get(channelId)?.get(socketId) }
  remove(channelId: string, socketId: string) { const r = this.rooms.get(channelId); r?.delete(socketId); if (r && r.size === 0) this.rooms.delete(channelId) }
  /** Every channel a socket is in (normally one). */
  channelsOf(socketId: string) { return [...this.rooms.entries()].filter(([, m]) => m.has(socketId)).map(([id]) => id) }
  clear(channelId: string) { this.rooms.delete(channelId); this.removed.delete(channelId) }
}

@Injectable()
export class VoiceService {
  constructor(private prisma: PrismaService) {}

  async channel(user: AuthUser, id: string) {
    const ch = await this.prisma.voiceChannel.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!ch) throw new NotFoundException()
    return ch
  }
  canJoin(user: AuthUser, classId: string) {
    return can(user, 'voice', 'join', { classId })
  }
  canManage(user: AuthUser, classId: string) {
    return can(user, 'voice', 'manage', { classId })
  }
}

/**
 * WebRTC signaling. Audio, video and screen streams flow directly between browsers; this server only
 * introduces peers and relays their connection messages. Every join re-checks class membership, and a
 * signal is only relayed between two people who are in the same call.
 */
@WebSocketGateway({ cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true } })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private log = new Logger('VoiceGateway')
  @WebSocketServer() server: Server

  constructor(private auth: AuthGuard, private svc: VoiceService, private rooms: VoiceRooms, private prisma: PrismaService, private audit: AuditService) {}

  // The chat gateway authenticates the connection; this makes voice work even if it runs first.
  async handleConnection(socket: Socket) {
    try {
      socket.data.user ??= await this.auth.authenticate(String(socket.handshake.auth?.token ?? ''))
    } catch {
      socket.disconnect(true)
    }
  }

  handleDisconnect(socket: Socket) {
    for (const id of this.rooms.channelsOf(socket.id)) this.leaveRoom(socket, id)
  }

  private async user(socket: Socket): Promise<AuthUser> {
    return (socket.data.user ??= await this.auth.authenticate(String(socket.handshake.auth?.token ?? '')))
  }

  private leaveRoom(socket: Socket, channelId: string) {
    if (!this.rooms.has(channelId, socket.id)) return
    this.rooms.remove(channelId, socket.id)
    socket.leave(`voice:${channelId}`)
    socket.to(`voice:${channelId}`).emit('voice:peer-left', { socketId: socket.id })
  }

  /** Disconnects everyone in a channel that has just been deleted. */
  closeChannel(channelId: string) {
    this.server?.to(`voice:${channelId}`).emit('voice:closed', { channelId })
    this.server?.in(`voice:${channelId}`).socketsLeave(`voice:${channelId}`)
    this.rooms.clear(channelId)
  }

  @SubscribeMessage('voice:join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() data: { channelId: string }) {
    try {
      const user = await this.user(socket)
      const ch = await this.svc.channel(user, String(data?.channelId))
      if (!this.svc.canJoin(user, ch.classId)) return { ok: false, error: 'You cannot join this channel' }
      if (this.rooms.banned(ch.id, user.id)) return { ok: false, error: `You were removed from this call. You can rejoin in a few minutes.` }
      // One call at a time per connection.
      for (const other of this.rooms.channelsOf(socket.id)) if (other !== ch.id) this.leaveRoom(socket, other)
      if (!this.rooms.has(ch.id, socket.id) && this.rooms.count(ch.id) >= MAX_PARTICIPANTS) return { ok: false, error: `This channel is full (${MAX_PARTICIPANTS} people)` }
      const peers = this.rooms.peers(ch.id).map((p) => ({ socketId: p.socketId, userId: p.userId, name: p.name, role: p.role, state: p.state }))
      const me = { socketId: socket.id, userId: user.id, name: user.name, role: user.role, state: { mic: false, camera: false, screenStreamId: null } as PeerState }
      this.rooms.add(ch.id, me)
      await socket.join(`voice:${ch.id}`)
      socket.to(`voice:${ch.id}`).emit('voice:peer-joined', me)
      return { ok: true, me: { socketId: socket.id, userId: user.id }, peers, channel: { id: ch.id, name: ch.name } }
    } catch (e) {
      this.log.warn(`join rejected: ${(e as Error).message}`)
      return { ok: false, error: 'You cannot join this channel' }
    }
  }

  @SubscribeMessage('voice:leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() data: { channelId: string }) {
    this.leaveRoom(socket, String(data?.channelId))
    return { ok: true }
  }

  /** Relays a WebRTC offer, answer or ICE candidate to one specific person in the same call. */
  @SubscribeMessage('voice:signal')
  signal(@ConnectedSocket() socket: Socket, @MessageBody() data: { channelId: string; to: string; data: unknown }) {
    const id = String(data?.channelId)
    if (!this.rooms.has(id, socket.id) || !this.rooms.has(id, String(data?.to))) return { ok: false }
    this.server.to(String(data.to)).emit('voice:signal', { from: socket.id, data: data.data })
    return { ok: true }
  }

  /** Mic, camera and screen-share status, so everyone can show the right icons. */
  @SubscribeMessage('voice:state')
  state(@ConnectedSocket() socket: Socket, @MessageBody() data: { channelId: string; mic?: boolean; camera?: boolean; screenStreamId?: string | null }) {
    const id = String(data?.channelId)
    const me = this.rooms.get(id, socket.id)
    if (!me) return { ok: false }
    me.state = {
      mic: !!data.mic,
      camera: !!data.camera,
      screenStreamId: typeof data.screenStreamId === 'string' ? data.screenStreamId.slice(0, 100) : null,
    }
    socket.to(`voice:${id}`).emit('voice:peer-state', { socketId: socket.id, state: me.state })
    return { ok: true }
  }

  /**
   * Moderation: someone who manages the class (its teacher, clerk, principal, admin) can mute or remove another person in the call.
   * Muting switches their microphone off (they can turn it back on). Removing ends their call and keeps them out for a few minutes.
   * A person who could moderate cannot be moderated, and nobody moderates themselves.
   */
  @SubscribeMessage('voice:moderate')
  async moderate(@ConnectedSocket() socket: Socket, @MessageBody() data: { channelId: string; to: string; action: 'mute' | 'remove' }) {
    try {
      const user = await this.user(socket)
      const channelId = String(data?.channelId), to = String(data?.to)
      const ch = await this.svc.channel(user, channelId)
      if (!this.rooms.has(channelId, socket.id) || !this.svc.canManage(user, ch.classId)) return { ok: false, error: 'Not allowed' }
      const target = this.rooms.get(channelId, to)
      if (!target || to === socket.id) return { ok: false, error: 'That person is not in the call' }
      const targetSocket = this.server.sockets.sockets.get(to)
      const targetUser = targetSocket?.data.user as AuthUser | undefined
      if (!targetSocket || !targetUser || this.svc.canManage(targetUser, ch.classId)) return { ok: false, error: 'You cannot do that to this person' }
      if (data.action === 'mute') {
        target.state = { ...target.state, mic: false }
        targetSocket.emit('voice:muted', { by: user.name })
        this.server.to(`voice:${channelId}`).emit('voice:peer-state', { socketId: to, state: target.state })
      } else if (data.action === 'remove') {
        this.rooms.ban(channelId, target.userId, Date.now() + REMOVAL_MINUTES * 60_000)
        targetSocket.emit('voice:removed', { by: user.name })
        this.leaveRoom(targetSocket, channelId)
      } else return { ok: false, error: 'Unknown action' }
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: data.action === 'mute' ? 'voice.participant_muted' : 'voice.participant_removed', resource: 'voice_channel', resourceId: channelId, meta: { classId: ch.classId, targetUserId: target.userId, targetName: target.name } })
      return { ok: true }
    } catch {
      return { ok: false, error: 'Not allowed' }
    }
  }
}

@Controller('voice')
@UseGuards(AuthGuard, PermissionGuard)
export class VoiceController {
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: VoiceService, private rooms: VoiceRooms, private gw: VoiceGateway) {}

  private async classOf(user: AuthUser, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId }, select: { id: true } })
    if (!cls) throw new ForbiddenException()
  }

  @Get('class/:classId')
  async list(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    await this.classOf(user, classId)
    if (!this.svc.canJoin(user, classId)) throw new ForbiddenException()
    const rows = await this.prisma.voiceChannel.findMany({ where: { classId }, orderBy: { createdAt: 'asc' } })
    return {
      canManage: this.svc.canManage(user, classId),
      max: MAX_PARTICIPANTS,
      channels: rows.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, participants: this.rooms.peers(c.id).map((p) => ({ name: p.name, role: p.role })) })),
    }
  }

  @Post('class/:classId')
  async create(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Body() dto: CreateChannelDto) {
    await this.classOf(user, classId)
    if (!this.svc.canManage(user, classId)) throw new ForbiddenException()
    const name = dto.name.trim().replace(/\s+/g, ' ')
    if (!name) throw new BadRequestException('Give the channel a name')
    if (await this.prisma.voiceChannel.findFirst({ where: { classId, name: { equals: name, mode: 'insensitive' } } })) throw new BadRequestException('A voice channel with this name already exists')
    const ch = await this.prisma.voiceChannel.create({ data: { schoolId: user.schoolId, classId, name, createdById: user.id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'voice.channel_created', resource: 'voice_channel', resourceId: ch.id, meta: { classId, name } })
    return ch
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const ch = await this.svc.channel(user, id)
    if (!this.svc.canManage(user, ch.classId)) throw new ForbiddenException()
    await this.prisma.voiceChannel.delete({ where: { id } })
    this.gw.closeChannel(id) // anyone still in the call is disconnected from it
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'voice.channel_deleted', resource: 'voice_channel', resourceId: id, meta: { classId: ch.classId, name: ch.name } })
    return { ok: true }
  }

  /** Private notes: each person has their own per channel and nobody else can read them. */
  @Get(':id/notes')
  async getNote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const ch = await this.svc.channel(user, id)
    if (!this.svc.canJoin(user, ch.classId)) throw new ForbiddenException()
    const n = await this.prisma.voiceNote.findUnique({ where: { channelId_userId: { channelId: id, userId: user.id } } })
    return { body: n?.body ?? '', updatedAt: n?.updatedAt ?? null }
  }

  @Put(':id/notes')
  async putNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NoteDto) {
    const ch = await this.svc.channel(user, id)
    if (!this.svc.canJoin(user, ch.classId)) throw new ForbiddenException()
    const n = await this.prisma.voiceNote.upsert({ where: { channelId_userId: { channelId: id, userId: user.id } }, update: { body: dto.body }, create: { channelId: id, userId: user.id, body: dto.body } })
    return { ok: true, updatedAt: n.updatedAt }
  }
}

@Module({ providers: [VoiceRooms, VoiceService, VoiceGateway], controllers: [VoiceController] })
export class VoiceModule {}
