import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertClean } from './scan'
import { s3Config, s3Delete, s3Get, s3Put } from './s3'
import { driveConfig, driveDelete, driveGet, drivePut, type CheckStep, type DriveConfig } from './drive'

/**
 * File storage behind three calls (putFile, getFile, deleteFile). Files are stored under a random key; the original name lives
 * in the database, never in storage.
 *
 * Two places can hold a file:
 *   - the MAIN storage ("primary"): a folder on this server (UPLOAD_DIR), or, when S3_BUCKET is set, an S3-compatible bucket
 *     (Amazon S3, Cloudflare R2, MinIO and so on, see s3.ts);
 *   - GOOGLE DRIVE, as extra room (see drive.ts), when it is set up.
 *
 * Where a NEW file goes follows the school's storage mode: "auto" uses the main storage and switches to Drive when the main
 * storage is full (above STORAGE_PRIMARY_LIMIT_GB, or when it refuses the file); "primary" always uses the main storage;
 * "drive" always uses Drive. A registry (the StorageObject table, bound in at start-up) remembers where each file went, so reading
 * and deleting find it. A file with no registry entry is in the main storage, as everything was before Drive existed.
 *
 * Moving an existing school from disk to a bucket means copying the files in UPLOAD_DIR into the bucket under the same names.
 */
export type Backend = 'primary' | 'drive'
export type StorageMode = 'auto' | 'primary' | 'drive'
export const STORAGE_MODES: StorageMode[] = ['auto', 'primary', 'drive']

export interface StorageRegistry {
  find(key: string): Promise<{ backend: Backend; remoteId: string | null; schoolId?: string | null } | null>
  record(row: { key: string; backend: Backend; remoteId: string | null; size: number; schoolId: string | null }): Promise<void>
  forget(key: string): Promise<void>
  /** Bytes the registry says are in the main storage, over every school. */
  primaryBytes(): Promise<number>
  mode(schoolId: string): Promise<StorageMode>
}

let registry: StorageRegistry | null = null
/** Called once at start-up by the database-backed registry. Without one (some tests) everything is simply in the main storage. */
export const bindStorageRegistry = (r: StorageRegistry | null) => { registry = r }

let driveResolver: ((schoolId: string) => Promise<DriveConfig | null>) | null = null
/** Called once at start-up: looks up the Google Drive a school linked on the Storage page. */
export const bindDriveResolver = (r: typeof driveResolver) => { driveResolver = r }

/** The Drive a school's files use: the one the school connected, else the one set in the server's settings, else none. */
export async function driveFor(schoolId?: string | null): Promise<DriveConfig | null> {
  const own = schoolId && driveResolver ? await driveResolver(schoolId).catch(() => null) : null
  return own ?? driveConfig()
}

const root = () => resolve(process.env.UPLOAD_DIR ?? './uploads')

export const newKey = () => randomUUID()

async function primaryPut(key: string, data: Buffer) {
  const s3 = s3Config()
  if (s3) return s3Put(s3, key, data)
  await mkdir(root(), { recursive: true })
  await writeFile(join(root(), key), data)
}
async function primaryGet(key: string): Promise<Buffer> {
  const s3 = s3Config()
  return s3 ? s3Get(s3, key) : readFile(join(root(), key))
}
async function primaryDelete(key: string) {
  const s3 = s3Config()
  if (s3) return s3Delete(s3, key)
  await rm(join(root(), key), { force: true })
}

/** The size, in bytes, the main storage may grow to before Drive takes over; null when no limit is set. */
export function primaryLimitBytes(): number | null {
  const gb = Number(process.env.STORAGE_PRIMARY_LIMIT_GB)
  return Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : null
}

export interface Choice {
  backend: Backend
  /** True when the main storage may be tried and, if it refuses the file, Drive may take it instead. */
  mayFallBack: boolean
  why: 'drive-not-set-up' | 'chosen-main' | 'chosen-drive' | 'auto-main' | 'auto-main-full'
}

/** Where a new file of this size for this school goes right now. */
export async function chooseBackend(schoolId: string | undefined, size = 0): Promise<Choice> {
  if (!registry || !(await driveFor(schoolId))) return { backend: 'primary', mayFallBack: false, why: 'drive-not-set-up' }
  const mode = schoolId ? await registry.mode(schoolId).catch((): StorageMode => 'auto') : 'auto'
  if (mode === 'primary') return { backend: 'primary', mayFallBack: false, why: 'chosen-main' }
  if (mode === 'drive') return { backend: 'drive', mayFallBack: false, why: 'chosen-drive' }
  const limit = primaryLimitBytes()
  if (limit !== null && (await registry.primaryBytes()) + size > limit) return { backend: 'drive', mayFallBack: false, why: 'auto-main-full' }
  return { backend: 'primary', mayFallBack: true, why: 'auto-main' }
}

/** Every stored file passes through here, so scanning (when enabled) covers homework, resources, documents and messages alike. */
export async function putFile(key: string, data: Buffer, opts: { schoolId?: string; /** Keep it in the main storage whatever the mode (for files shown on public pages). */ forcePrimary?: boolean } = {}) {
  await assertClean(data)
  const schoolId = opts.schoolId ?? null
  const choice: Choice = opts.forcePrimary ? { backend: 'primary', mayFallBack: false, why: 'chosen-main' } : await chooseBackend(opts.schoolId, data.length)

  const toDrive = async () => {
    const cfg = await driveFor(opts.schoolId)
    if (!cfg) throw new Error('Google Drive is not set up')
    const remoteId = await drivePut(cfg, key, data)
    try {
      await registry?.record({ key, backend: 'drive', remoteId, size: data.length, schoolId })
    } catch (e) {
      // Without the registry entry the file could never be found again, so do not leave it behind.
      await driveDelete(cfg, remoteId).catch(() => undefined)
      throw e
    }
  }

  if (choice.backend === 'drive') return toDrive()
  try {
    await primaryPut(key, data)
  } catch (e) {
    if (choice.mayFallBack && (await driveFor(opts.schoolId))) return toDrive() // the main storage refused the file (for example it is full)
    throw e
  }
  try {
    await registry?.record({ key, backend: 'primary', remoteId: null, size: data.length, schoolId })
  } catch { /* the file is stored and is found by default; only the space count misses it */ }
}

export async function getFile(key: string): Promise<Buffer> {
  const row = registry ? await registry.find(key).catch(() => null) : null
  if (row?.backend === 'drive') {
    const cfg = await driveFor(row.schoolId)
    if (!cfg || !row.remoteId) throw new Error('This file is in Google Drive, which is not set up')
    return driveGet(cfg, row.remoteId)
  }
  return primaryGet(key)
}

export async function deleteFile(key: string) {
  const row = registry ? await registry.find(key).catch(() => null) : null
  if (row?.backend === 'drive') {
    const cfg = await driveFor(row.schoolId)
    if (cfg && row.remoteId) await driveDelete(cfg, row.remoteId)
  } else {
    await primaryDelete(key)
  }
  await registry?.forget(key).catch(() => undefined)
}

/** Where the main storage is, for the platform health/status screens. */
export const storageKind = () => (s3Config() ? 's3' : 'disk')

/** Tries the main storage the way the app uses it: save, read back, delete, confirm gone. Touches only its own test file. */
export async function checkPrimary(): Promise<CheckStep[]> {
  const key = `_check-${randomUUID()}`
  const data = Buffer.from(`school platform storage check ${new Date().toISOString()}`)
  const steps: CheckStep[] = []
  const run = async (step: string, fn: () => Promise<void>) => {
    const t = Date.now()
    try { await fn(); steps.push({ step, ok: true, ms: Date.now() - t }) }
    catch (e) { steps.push({ step, ok: false, ms: Date.now() - t, error: (e as Error).message }) }
  }
  await run('save a file', () => primaryPut(key, data))
  await run('read it back and compare', async () => { if (!(await primaryGet(key)).equals(data)) throw new Error('the file that came back is different') })
  await run('delete it', () => primaryDelete(key))
  await run('confirm it is gone', async () => {
    try { await primaryGet(key) } catch { return }
    throw new Error('the file is still there after deleting it')
  })
  return steps
}
