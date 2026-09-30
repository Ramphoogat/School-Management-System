import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertClean } from './scan'
import { s3Config, s3Delete, s3Get, s3Put } from './s3'

/**
 * File storage behind three calls. By default files go to a folder on this server (UPLOAD_DIR). Set S3_BUCKET (and the
 * other S3_* settings, see s3.ts) and they go to an S3-compatible bucket instead: Amazon S3, Cloudflare R2, MinIO and so on.
 * Files are stored under a random key; the original name lives in the database, never in storage.
 *
 * Moving an existing school from disk to a bucket means copying the files in UPLOAD_DIR into the bucket under the same names.
 */
const root = () => resolve(process.env.UPLOAD_DIR ?? './uploads')

export const newKey = () => randomUUID()

/** Every stored file passes through here, so scanning (when enabled) covers homework, resources, documents and messages alike. */
export async function putFile(key: string, data: Buffer) {
  await assertClean(data)
  const s3 = s3Config()
  if (s3) return s3Put(s3, key, data)
  await mkdir(root(), { recursive: true })
  await writeFile(join(root(), key), data)
}

export async function getFile(key: string): Promise<Buffer> {
  const s3 = s3Config()
  return s3 ? s3Get(s3, key) : readFile(join(root(), key))
}

export async function deleteFile(key: string) {
  const s3 = s3Config()
  if (s3) return s3Delete(s3, key)
  await rm(join(root(), key), { force: true })
}

/** Where files are kept, for the platform health/status screens. */
export const storageKind = () => (s3Config() ? 's3' : 'disk')
