import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, OnModuleDestroy, Post, Put, UseGuards } from '@nestjs/common'
import { IsIn } from 'class-validator'
import { statfs } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'
import { s3Config } from './s3'
import { bindDriveResolver, bindStorageRegistry, driveFor, checkPrimary, chooseBackend, primaryLimitBytes, storageKind, STORAGE_MODES, type Backend, type StorageMode, type StorageRegistry } from './storage'
import { driveAbout, driveCheck, driveShareEmail, googleClient, type DriveConfig } from './drive'
import { openSecret } from './secret'

class ModeDto {
  @IsIn(STORAGE_MODES) mode: StorageMode
}

const asMode = (v: string | null | undefined): StorageMode => (STORAGE_MODES as string[]).includes(v ?? '') ? (v as StorageMode) : 'auto'

/** Keeps track of where every stored file is (the StorageObject table) and each school's storage mode. */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private registry: StorageRegistry

  constructor(private prisma: PrismaService) {
    this.registry = {
      find: async (key) => {
        const r = await this.prisma.storageObject.findUnique({ where: { key } })
        return r ? { backend: r.backend as Backend, remoteId: r.remoteId, schoolId: r.schoolId } : null
      },
      record: async (row) => {
        await this.prisma.storageObject.upsert({
          where: { key: row.key },
          update: { backend: row.backend, remoteId: row.remoteId, size: row.size, schoolId: row.schoolId },
          create: row,
        })
      },
      forget: async (key) => { await this.prisma.storageObject.deleteMany({ where: { key } }) },
      primaryBytes: async () => (await this.prisma.storageObject.aggregate({ where: { backend: 'primary' }, _sum: { size: true } }))._sum.size ?? 0,
      mode: async (schoolId) => asMode((await this.prisma.storageSetting.findUnique({ where: { schoolId } }))?.mode),
    }
    bindStorageRegistry(this.registry)
    bindDriveResolver((schoolId) => this.connectedDrive(schoolId))
  }

  onModuleDestroy() { bindStorageRegistry(null); bindDriveResolver(null) }

  /** The Drive this school linked by signing in with Google, ready to use. Null when it has not linked one. */
  async connectedDrive(schoolId: string): Promise<DriveConfig | null> {
    const g = googleClient()
    const row = g ? await this.prisma.driveConnection.findUnique({ where: { schoolId } }) : null
    if (!g || !row) return null
    return { folderId: row.folderId, apiBase: g.apiBase, tokenUrl: g.tokenUrl, auth: { type: 'oauth', clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: openSecret(row.refreshToken) } }
  }

  mode(schoolId: string) { return this.registry.mode(schoolId) }

  /** Everything the storage screen shows. */
  async status(schoolId: string) {
    const cfg = await driveFor(schoolId)
    const link = await this.prisma.driveConnection.findUnique({ where: { schoolId }, select: { email: true, folderId: true, createdAt: true } })
    const [mode, everyone, mine, choice] = await Promise.all([
      this.registry.mode(schoolId),
      this.prisma.storageObject.groupBy({ by: ['backend'], _sum: { size: true } }),
      this.prisma.storageObject.groupBy({ by: ['backend'], where: { schoolId }, _sum: { size: true }, _count: { _all: true } }),
      chooseBackend(schoolId, 0),
    ])
    const sumOf = (rows: { backend: string; _sum: { size: number | null } }[], b: Backend) => rows.find((r) => r.backend === b)?._sum.size ?? 0
    const countOf = (b: Backend) => (mine.find((r) => r.backend === b)?._count as { _all: number } | undefined)?._all ?? 0

    // Which service holds the main storage, and (for the server's own disk) how much room is left on it.
    const s3 = s3Config()
    const host = s3?.endpoint ? new URL(s3.endpoint).hostname : ''
    const provider = !s3 ? 'disk' : host.endsWith('r2.cloudflarestorage.com') ? 'cloudflare-r2' : !s3.endpoint ? 'amazon-s3' : 's3-compatible'
    let disk: { freeBytes: number; totalBytes: number } | null = null
    if (!s3) {
      try { const f = await statfs(resolve(process.env.UPLOAD_DIR ?? './uploads')); disk = { freeBytes: f.bavail * f.bsize, totalBytes: f.blocks * f.bsize } } catch { /* folder not created yet */ }
    }

    let account: { email: string | null; limit: number | null; usage: number | null } | null = null
    let driveError: string | null = null
    if (cfg) {
      try { account = await driveAbout(cfg) } catch (e) { driveError = (e as Error).message }
    }
    return {
      mode,
      activeNow: choice.backend,
      reason: choice.why,
      main: {
        kind: storageKind(),
        provider,
        bucket: s3?.bucket ?? null,
        endpointHost: host || null,
        disk,
        usedBytes: sumOf(everyone, 'primary'),
        limitBytes: primaryLimitBytes(),
        schoolBytes: sumOf(mine, 'primary'),
        schoolFiles: countOf('primary'),
      },
      drive: {
        configured: !!cfg,
        source: link ? 'connected' : cfg ? 'server' : null,
        canConnect: !!googleClient(),
        folderUrl: link ? `https://drive.google.com/drive/folders/${link.folderId}` : null,
        shareWith: driveShareEmail(cfg),
        usedBytes: sumOf(everyone, 'drive'),
        schoolBytes: sumOf(mine, 'drive'),
        schoolFiles: countOf('drive'),
        account: account?.email ?? null,
        quotaLimitBytes: account?.limit ?? null,
        quotaUsedBytes: account?.usage ?? null,
        error: driveError,
      },
    }
  }
}

/** The storage screen: how much room is used where, and which place new files go. Clerk, principal and admin. */
@Controller('storage')
@UseGuards(AuthGuard, PermissionGuard)
export class StorageController {
  constructor(private prisma: PrismaService, private audit: AuditService, private svc: StorageService) {}

  @Get()
  @RequirePermission('storage', 'manage')
  status(@CurrentUser() user: AuthUser) {
    return this.svc.status(user.schoolId)
  }

  /** Chooses where this school's new files go: automatic, always the main storage, or always Google Drive. Existing files stay where they are. */
  @Put('mode')
  @RequirePermission('storage', 'manage')
  async setMode(@CurrentUser() user: AuthUser, @Body() dto: ModeDto) {
    if (dto.mode === 'drive' && !(await driveFor(user.schoolId))) throw new BadRequestException('Google Drive is not connected yet, so it cannot be chosen. Connect it first.')
    const before = await this.svc.mode(user.schoolId)
    await this.prisma.storageSetting.upsert({
      where: { schoolId: user.schoolId },
      update: { mode: dto.mode, updatedById: user.id },
      create: { schoolId: user.schoolId, mode: dto.mode, updatedById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'storage.mode_changed', resource: 'storage', resourceId: user.schoolId, meta: { from: before, to: dto.mode } })
    return this.svc.status(user.schoolId)
  }

  /** Tries both places the way the app uses them (save, read back, delete) and says which step fails. */
  @Post('check')
  @RequirePermission('storage', 'manage')
  async check(@CurrentUser() user: AuthUser) {
    const cfg = await driveFor(user.schoolId)
    return {
      main: { kind: storageKind(), steps: await checkPrimary() },
      drive: cfg ? { steps: await driveCheck(cfg) } : null,
    }
  }
}

@Global()
@Module({ providers: [StorageService], controllers: [StorageController], exports: [StorageService] })
export class StorageModule {}
