import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { s3Delete, s3Get, s3Put, type S3Config } from './s3'

export interface CheckStep { step: string; ok: boolean; ms: number; error?: string }

/**
 * Tries the bucket the way the app will use it: save a small file, read it back, delete it, and confirm it is gone.
 * Nothing else in the bucket is touched. Used by `pnpm --filter @school/api storage:check`.
 */
export async function checkBucket(c: S3Config): Promise<CheckStep[]> {
  const key = `_check/${randomUUID()}`
  const data = Buffer.from(`school platform storage check ${new Date().toISOString()}`)
  const steps: CheckStep[] = []
  let back: Buffer | null = null
  const run = async (step: string, fn: () => Promise<void>) => {
    const t = Date.now()
    try { await fn(); steps.push({ step, ok: true, ms: Date.now() - t }) }
    catch (e) { steps.push({ step, ok: false, ms: Date.now() - t, error: (e as Error).message }) }
  }
  await run('save a file', () => s3Put(c, key, data))
  await run('read it back and compare', async () => { back = await s3Get(c, key); if (!back.equals(data)) throw new Error('the file that came back is different') })
  await run('delete it', () => s3Delete(c, key))
  await run('confirm it is gone', async () => {
    try { await s3Get(c, key) } catch (e) { if (/404/.test((e as Error).message)) return; throw e }
    throw new Error('the file is still there after deleting it')
  })
  return steps
}

export interface CopyResult { found: number; copied: number; failed: { name: string; error: string }[]; bytes: number; dryRun: boolean }

/**
 * Copies every file in a folder (the app's UPLOAD_DIR) into the bucket under the same names, which is what the database
 * refers to. Files are only read, never deleted or changed, so it is safe to run more than once. Each copy is read back and
 * compared unless `verify` is false.
 */
export async function copyFolderToBucket(dir: string, c: S3Config, opts: { dryRun?: boolean; verify?: boolean; onFile?: (name: string, i: number, n: number) => void } = {}): Promise<CopyResult> {
  const names: string[] = []
  for (const name of await readdir(dir)) {
    if (name.startsWith('.')) continue // not an uploaded file
    if ((await stat(join(dir, name))).isFile()) names.push(name)
  }
  const out: CopyResult = { found: names.length, copied: 0, failed: [], bytes: 0, dryRun: !!opts.dryRun }
  let i = 0
  for (const name of names) {
    opts.onFile?.(name, ++i, names.length)
    if (opts.dryRun) continue
    try {
      const data = await readFile(join(dir, name))
      await s3Put(c, name, data)
      if (opts.verify !== false && !(await s3Get(c, name)).equals(data)) throw new Error('the copy in the bucket is different from the original')
      out.copied++; out.bytes += data.length
    } catch (e) {
      out.failed.push({ name, error: (e as Error).message })
    }
  }
  return out
}
