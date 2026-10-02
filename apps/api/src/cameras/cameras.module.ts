import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

const KINDS = ['hls', 'mjpeg'] as const
const MAX_CAMERAS = 100
const UPSTREAM_TIMEOUT_MS = 15_000
/** How long a viewing link (for an <img>, which cannot send a header) stays valid. */
const VIEW_TOKEN_TTL = '10m'

class CameraDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string
  @IsOptional() @IsString() @MaxLength(120) location?: string
  @IsIn(KINDS) kind: (typeof KINDS)[number]
  @IsString() @MinLength(8) @MaxLength(1000) sourceUrl: string
  @IsOptional() @IsBoolean() enabled?: boolean
}
class CameraPatch {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string
  @IsOptional() @IsString() @MaxLength(120) location?: string
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number]
  /** Left out or empty keeps the stored address (the screen never shows it back, as it may hold a password). */
  @IsOptional() @IsString() @MaxLength(1000) sourceUrl?: string
  @IsOptional() @IsBoolean() enabled?: boolean
}

/** Only http(s) streams can be relayed: browsers cannot play RTSP, so those go through a gateway first (see SERVICES.md). */
export function parseSource(raw: string): URL {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new BadRequestException('That is not a valid web address.') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BadRequestException('Use an http:// or https:// stream address. Browsers cannot play rtsp:// directly: run the camera through a gateway such as go2rtc or MediaMTX and paste its HLS or MJPEG address.')
  }
  return u
}

/** The address with any password hidden, safe to show. */
export function maskSource(raw: string) {
  try {
    const u = new URL(raw)
    if (u.username || u.password) { u.username = '***'; u.password = '' }
    for (const k of [...u.searchParams.keys()]) if (/token|key|pass|auth|secret|sig/i.test(k)) u.searchParams.set(k, '***')
    return u.toString()
  } catch { return '' }
}

/** Where a file the player asked for lives upstream: next to the playlist, never outside its folder. */
export function upstreamFor(source: URL, rest: string): URL {
  const base = new URL(source.toString())
  const dir = base.pathname.replace(/[^/]*$/, '')
  const segments = rest.split('/').filter((s) => s !== '')
  if (segments.some((s) => s === '..' || s === '.' || s.includes('\\'))) throw new BadRequestException()
  base.pathname = dir + segments.join('/')
  return base // keeps the source's own query (a camera token), which is how many gateways authorise a stream
}

@Controller('cameras')
export class CamerasController {
  constructor(private prisma: PrismaService, private audit: AuditService, private jwt: JwtService, private auth: AuthGuard) {}

  private view(c: { id: string; name: string; location: string; kind: string; sourceUrl: string; enabled: boolean; createdAt: Date }, manage: boolean) {
    return { id: c.id, name: c.name, location: c.location, kind: c.kind, enabled: c.enabled, createdAt: c.createdAt, ...(manage ? { source: maskSource(c.sourceUrl) } : {}) }
  }

  private async load(user: AuthUser, id: string) {
    const c = await this.prisma.camera.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!c) throw new NotFoundException()
    return c
  }

  /** The sign-in is the normal bearer token, or a short viewing link made for this one camera (for <img>). */
  private async viewer(req: Request, cameraId: string, t?: string): Promise<AuthUser> {
    const header = req.headers.authorization
    let user: AuthUser
    if (header?.startsWith('Bearer ')) user = await this.auth.authenticate(header.slice(7))
    else if (t || req.headers['x-camera-token']) {
      t = t ?? String(req.headers['x-camera-token'])
      let p: { sub: string; cam: string; purpose: string; tv?: number }
      try { p = await this.jwt.verifyAsync(t as string, { secret: process.env.JWT_SECRET }) } catch { throw new UnauthorizedException() }
      if (p.purpose !== 'camera' || p.cam !== cameraId) throw new UnauthorizedException()
      // Same checks as a sign-in: still active, same role and school, and "sign out everywhere" still applies.
      const u = await this.prisma.user.findUnique({ where: { id: p.sub }, include: { school: { select: { active: true, isPlatform: true } } } })
      if (!u || !u.active || (p.tv ?? 0) !== u.tokenVersion || (!u.school.active && !u.school.isPlatform)) throw new UnauthorizedException()
      user = { id: u.id, role: u.role, schoolId: u.schoolId, email: u.email, name: u.name }
    } else throw new UnauthorizedException()
    if (!can(user, 'cameras', 'view')) throw new ForbiddenException()
    return user
  }

  @Get()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('cameras', 'view')
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.camera.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } })
    const manage = can(user, 'cameras', 'manage')
    return { canManage: manage, cameras: rows.map((c) => this.view(c, manage)) }
  }

  @Post()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('cameras', 'manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CameraDto) {
    parseSource(dto.sourceUrl)
    if ((await this.prisma.camera.count({ where: { schoolId: user.schoolId } })) >= MAX_CAMERAS) throw new BadRequestException(`A school can have up to ${MAX_CAMERAS} cameras.`)
    const c = await this.prisma.camera.create({
      data: { schoolId: user.schoolId, name: dto.name.trim(), location: dto.location?.trim() ?? '', kind: dto.kind, sourceUrl: dto.sourceUrl.trim(), enabled: dto.enabled ?? true, createdById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'camera.created', resource: 'camera', resourceId: c.id, meta: { name: c.name } })
    return this.view(c, true)
  }

  @Patch(':id')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('cameras', 'manage')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CameraPatch) {
    await this.load(user, id)
    const data: Record<string, unknown> = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.location !== undefined) data.location = dto.location.trim()
    if (dto.kind !== undefined) data.kind = dto.kind
    if (dto.enabled !== undefined) data.enabled = dto.enabled
    if (dto.sourceUrl?.trim()) { parseSource(dto.sourceUrl); data.sourceUrl = dto.sourceUrl.trim() }
    const c = await this.prisma.camera.update({ where: { id }, data })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'camera.updated', resource: 'camera', resourceId: id, meta: { name: c.name, changed: Object.keys(data) } })
    return this.view(c, true)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('cameras', 'manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.load(user, id)
    await this.prisma.camera.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'camera.deleted', resource: 'camera', resourceId: id, meta: { name: c.name } })
    return { ok: true }
  }

  /** Opening a camera. Logged here, once per viewing, not for every video segment. */
  @Post(':id/open')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('cameras', 'view')
  async open(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body('renew') renew?: boolean) {
    const c = await this.load(user, id)
    if (!c.enabled) throw new BadRequestException('This camera is switched off.')
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenVersion: true } })
    const token = await this.jwt.signAsync({ sub: user.id, cam: id, purpose: 'camera', tv: full.tokenVersion }, { secret: process.env.JWT_SECRET, expiresIn: VIEW_TOKEN_TTL })
    if (!renew) await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'camera.viewed', resource: 'camera', resourceId: id, meta: { name: c.name } })
    return { token, kind: c.kind }
  }

  private async relay(req: Request, res: Response, url: URL) {
    const ac = new AbortController()
    res.on('close', () => ac.abort())
    const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
    let up: globalThis.Response
    try {
      const headers: Record<string, string> = {}
      if (url.username || url.password) {
        headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
        url.username = ''; url.password = ''
      }
      if (req.headers.range) headers.range = String(req.headers.range)
      up = await fetch(url, { headers, signal: ac.signal, redirect: 'error' })
    } catch {
      clearTimeout(timer)
      if (!res.headersSent) res.status(502).json({ message: 'The camera did not answer.' })
      return
    }
    clearTimeout(timer) // the timeout covers connecting; a live stream may then run for as long as it likes
    res.status(up.status)
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v) }
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (!up.body) { res.end(); return }
    const body = Readable.fromWeb(up.body as never)
    body.on('error', () => res.destroy())
    body.pipe(res)
  }

  /** The HLS playlist, and the video pieces next to it, relayed after the sign-in check. */
  @Get(':id/hls/*')
  async hls(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('0') rest: string, @Query('t') t?: string) {
    const user = await this.viewer(req, id, t)
    const c = await this.load(user, id)
    if (!c.enabled || c.kind !== 'hls') throw new NotFoundException()
    const source = parseSource(c.sourceUrl)
    const wanted = rest === 'index.m3u8' ? source : upstreamFor(source, rest)
    await this.relay(req, res, wanted)
  }

  @Get(':id/mjpeg')
  async mjpeg(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('t') t?: string) {
    const user = await this.viewer(req, id, t)
    const c = await this.load(user, id)
    if (!c.enabled || c.kind !== 'mjpeg') throw new NotFoundException()
    await this.relay(req, res, parseSource(c.sourceUrl))
  }
}

@Module({ controllers: [CamerasController], providers: [AuthGuard] })
export class CamerasModule {}
