import { BadRequestException, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtService } from '@nestjs/jwt'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'
import { cleanName, MAX_FILE_BYTES, FILE_TYPES, type Upload } from './upload-rules'
import { driveAbout, driveCreateFolder, driveDelete, drivePut, driveStream, exchangeCode, googleAuthUrl, googleClient, revokeToken } from './drive'
import { driveFor } from './storage'
import { sealSecret, openSecret } from './secret'

/** What the Drive files page accepts: everything the rest of the app allows, plus pictures and video. Judged by the file's own bytes. */
const ftyp = (b: Buffer) => b.subarray(4, 8).toString() === 'ftyp'
export const DRIVE_TYPES: Record<string, { mime: string; ok: (b: Buffer) => boolean }> = {
  ...FILE_TYPES,
  gif: { mime: 'image/gif', ok: (b) => b.subarray(0, 4).toString() === 'GIF8' },
  webp: { mime: 'image/webp', ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  mp4: { mime: 'video/mp4', ok: ftyp },
  m4v: { mime: 'video/mp4', ok: ftyp },
  mov: { mime: 'video/quicktime', ok: ftyp },
  webm: { mime: 'video/webm', ok: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ok: (b) => b.subarray(0, 2).toString() === 'PK' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ok: (b) => b.subarray(0, 2).toString() === 'PK' },
  csv: { mime: 'text/csv; charset=utf-8', ok: (b) => !b.includes(0) },
}
export const DRIVE_ALLOWED_TEXT = 'Photos (PNG, JPG, GIF, WEBP), videos (MP4, MOV, WEBM), PDF, Word, Excel, PowerPoint, TXT, CSV'
/** These open in the browser; everything else is only ever downloaded. */
const INLINE = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime|webm)|application\/pdf)$/

const webOrigin = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '')

/** Signs a school in to its own Google Drive. The callback is where Google sends the person back, so it cannot use the normal sign-in header. */
@Controller('storage/drive')
export class DriveConnectController {
  constructor(private prisma: PrismaService, private audit: AuditService, private jwt: JwtService) {}

  /** Step 1: the browser is sent to this address, which is Google's own sign-in page. */
  @Post('connect')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('storage', 'manage')
  async connect(@CurrentUser() user: AuthUser) {
    const g = googleClient()
    if (!g) throw new BadRequestException('Google sign-in is not set up on this server yet. The person who runs the server needs to add the Google client ID and secret (see SERVICES.md).')
    const state = await this.jwt.signAsync({ sub: user.id, sid: user.schoolId, purpose: 'drive-connect' }, { secret: process.env.JWT_SECRET, expiresIn: '10m' })
    return { url: googleAuthUrl(g, state) }
  }

  /** Step 2: Google sends the person back here with a one-time code. */
  @Get('callback')
  async callback(@Res() res: Response, @Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    const back = (q: string) => res.redirect(`${webOrigin()}/storage?${q}`)
    if (error) return back('drive=denied')
    let p: { sub: string; sid: string; purpose: string }
    try { p = await this.jwt.verifyAsync(state ?? '', { secret: process.env.JWT_SECRET }) } catch { return back('drive=error') }
    if (p.purpose !== 'drive-connect' || !code) return back('drive=error')
    const u = await this.prisma.user.findUnique({ where: { id: p.sub } })
    if (!u || !u.active || u.schoolId !== p.sid || !can({ id: u.id, role: u.role, schoolId: u.schoolId }, 'storage', 'manage')) return back('drive=error')
    const g = googleClient()
    if (!g) return back('drive=error')
    try {
      const refresh = await exchangeCode(g, code)
      const cfg = { folderId: 'root', apiBase: g.apiBase, tokenUrl: g.tokenUrl, auth: { type: 'oauth' as const, clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: refresh } }
      const school = await this.prisma.school.findUnique({ where: { id: p.sid }, select: { name: true } })
      const folderId = await driveCreateFolder(cfg, `${school?.name ?? 'School'} files`)
      const about = await driveAbout(cfg).catch(() => null)
      const old = await this.prisma.driveConnection.findUnique({ where: { schoolId: p.sid } })
      const data = { email: about?.email ?? null, refreshToken: sealSecret(refresh), folderId, connectedById: u.id }
      await this.prisma.driveConnection.upsert({ where: { schoolId: p.sid }, update: data, create: { schoolId: p.sid, ...data } })
      if (old) void revokeToken(openSecret(old.refreshToken))
      await this.audit.log(this.prisma, { schoolId: p.sid, actorId: u.id, action: 'storage.drive_connected', resource: 'storage', resourceId: p.sid, meta: { account: about?.email ?? null } })
      return back('drive=connected')
    } catch {
      return back('drive=error')
    }
  }

  @Post('disconnect')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('storage', 'manage')
  async disconnect(@CurrentUser() user: AuthUser) {
    const row = await this.prisma.driveConnection.findUnique({ where: { schoolId: user.schoolId } })
    if (!row) throw new NotFoundException('Google Drive is not connected through sign-in.')
    await this.prisma.driveConnection.delete({ where: { schoolId: user.schoolId } })
    void revokeToken(openSecret(row.refreshToken))
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'storage.drive_disconnected', resource: 'storage', resourceId: user.schoolId, meta: { account: row.email } })
    return { ok: true }
  }
}

/** The school's Drive library: photos, videos and documents. Everyone except students and parents. */
@Controller('drive/files')
@UseGuards(AuthGuard, PermissionGuard)
export class DriveFilesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  @RequirePermission('drive', 'use')
  async list(@CurrentUser() user: AuthUser) {
    const cfg = await driveFor(user.schoolId)
    if (!cfg) return { connected: false, canConnect: can(user, 'storage', 'manage'), allowed: DRIVE_ALLOWED_TEXT, files: [] }
    const rows = await this.prisma.driveFile.findMany({ where: { schoolId: user.schoolId }, orderBy: { createdAt: 'desc' }, take: 500 })
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uploadedById))] } }, select: { id: true, name: true } })
    const who = new Map(people.map((p) => [p.id, p.name]))
    const manage = can(user, 'storage', 'manage')
    return {
      connected: true,
      canConnect: manage,
      allowed: DRIVE_ALLOWED_TEXT,
      files: rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, createdAt: r.createdAt, uploadedBy: who.get(r.uploadedById) ?? '', canDelete: manage || r.uploadedById === user.id })),
    }
  }

  @Post()
  @RequirePermission('drive', 'use')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Upload | undefined) {
    const cfg = await driveFor(user.schoolId)
    if (!cfg) throw new BadRequestException('Google Drive is not connected yet. Ask the principal or admin to connect it on the Storage page.')
    if (!file) throw new BadRequestException('Choose a file to upload (max 100 MB)')
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
    const type = DRIVE_TYPES[ext]
    if (!type || !type.ok(file.buffer)) throw new BadRequestException(`Allowed files: ${DRIVE_ALLOWED_TEXT}`)
    const name = cleanName(file.originalname)
    const driveId = await drivePut(cfg, `${randomUUID()}-${name}`, file.buffer)
    const row = await this.prisma.driveFile.create({ data: { schoolId: user.schoolId, uploadedById: user.id, name, mime: type.mime, size: file.buffer.length, driveId } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'drive.file_uploaded', resource: 'drive_file', resourceId: row.id, meta: { name, size: row.size } })
    return { id: row.id, name: row.name }
  }

  private async load(user: AuthUser, id: string) {
    const f = await this.prisma.driveFile.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!f) throw new NotFoundException()
    return f
  }

  /** Streams the file from the school's Drive. Pictures, video and PDF open in the page; anything else downloads. */
  @Get(':id')
  @RequirePermission('drive', 'use')
  async open(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response, @Query('download') download?: string) {
    const f = await this.load(user, id)
    const cfg = await driveFor(user.schoolId)
    if (!cfg) throw new BadRequestException('Google Drive is not connected.')
    const up = await driveStream(cfg, f.driveId, req.headers.range ? String(req.headers.range) : undefined).catch(() => null)
    if (!up) throw new NotFoundException('The file is missing from Google Drive')
    res.status(up.status)
    for (const h of ['content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(h); if (v) res.setHeader(h, v) }
    res.setHeader('Content-Type', f.mime)
    res.setHeader('Content-Disposition', `${INLINE.test(f.mime) && !download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
    res.setHeader('Cache-Control', 'private, no-store')
    if (!up.body) { res.end(); return }
    const body = Readable.fromWeb(up.body as never)
    res.on('close', () => body.destroy())
    body.on('error', () => res.destroy())
    body.pipe(res)
  }

  @Delete(':id')
  @RequirePermission('drive', 'use')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const f = await this.load(user, id)
    if (!(can(user, 'storage', 'manage') || f.uploadedById === user.id)) throw new ForbiddenException()
    const cfg = await driveFor(user.schoolId)
    if (cfg) await driveDelete(cfg, f.driveId)
    await this.prisma.driveFile.delete({ where: { id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'drive.file_deleted', resource: 'drive_file', resourceId: id, meta: { name: f.name } })
    return { ok: true }
  }
}

@Module({ controllers: [DriveConnectController, DriveFilesController] })
export class DriveModule {}
