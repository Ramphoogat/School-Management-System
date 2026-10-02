import { createHash, createSign, randomUUID } from 'node:crypto'

/**
 * A small Google Drive client, written without Google's SDK (like s3.ts). Used as extra storage: when the main storage is full,
 * or when someone chooses it, files go to one Drive folder. Two ways to sign in, whichever is set:
 *
 *   Service account (works with Google Workspace and with a normal Gmail account; share the folder with the robot's email):
 *     GDRIVE_SERVICE_ACCOUNT_JSON    the whole key file, on one line (or GDRIVE_CLIENT_EMAIL + GDRIVE_PRIVATE_KEY)
 *   A person's own sign-in (use this when you want the person's own storage space, for example a Workspace account with more room):
 *     GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
 *
 *   GDRIVE_FOLDER_ID                 the Drive folder the files are kept in (required)
 *
 * GDRIVE_API_BASE and GDRIVE_TOKEN_URL exist so tests can point at a stand-in server.
 */
export type DriveAuth =
  | { type: 'service'; email: string; privateKey: string }
  | { type: 'oauth'; clientId: string; clientSecret: string; refreshToken: string }

export interface DriveConfig { folderId: string; auth: DriveAuth; apiBase: string; tokenUrl: string }

export class DriveError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function driveConfig(env: Record<string, string | undefined> = process.env): DriveConfig | null {
  const folderId = env.GDRIVE_FOLDER_ID?.trim()
  if (!folderId) return null
  const apiBase = (env.GDRIVE_API_BASE || 'https://www.googleapis.com').replace(/\/+$/, '')
  const tokenUrl = env.GDRIVE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
  let auth: DriveAuth | null = null
  if (env.GDRIVE_SERVICE_ACCOUNT_JSON) {
    try {
      const j = JSON.parse(env.GDRIVE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string }
      if (j.client_email && j.private_key) auth = { type: 'service', email: j.client_email, privateKey: j.private_key.replace(/\\n/g, '\n') }
    } catch { /* not valid JSON: treated as not configured below */ }
  } else if (env.GDRIVE_CLIENT_EMAIL && env.GDRIVE_PRIVATE_KEY) {
    auth = { type: 'service', email: env.GDRIVE_CLIENT_EMAIL, privateKey: env.GDRIVE_PRIVATE_KEY.replace(/\\n/g, '\n') }
  } else if (env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN) {
    auth = { type: 'oauth', clientId: env.GDRIVE_CLIENT_ID, clientSecret: env.GDRIVE_CLIENT_SECRET, refreshToken: env.GDRIVE_REFRESH_TOKEN }
  }
  return auth ? { folderId, auth, apiBase, tokenUrl } : null
}

/** The robot's email address, which people share a Drive file or folder with so the app can read it. Null for a personal sign-in. */
export const driveShareEmail = (c: DriveConfig | null) => (c?.auth.type === 'service' ? c.auth.email : null)

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function accessToken(c: DriveConfig): Promise<string> {
  const cacheKey = `${c.tokenUrl}|${c.auth.type === 'service' ? c.auth.email : `${c.auth.clientId}|${createHash('sha256').update(c.auth.refreshToken).digest('hex').slice(0, 16)}`}`
  const hit = tokenCache.get(cacheKey)
  if (hit && hit.expiresAt - Date.now() > 60_000) return hit.token

  const form = new URLSearchParams()
  if (c.auth.type === 'service') {
    const now = Math.floor(Date.now() / 1000)
    const claims = { iss: c.auth.email, scope: 'https://www.googleapis.com/auth/drive', aud: c.tokenUrl, iat: now, exp: now + 3600 }
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(c.auth.privateKey)
    form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    form.set('assertion', `${unsigned}.${b64url(signature)}`)
  } else {
    form.set('grant_type', 'refresh_token')
    form.set('client_id', c.auth.clientId)
    form.set('client_secret', c.auth.clientSecret)
    form.set('refresh_token', c.auth.refreshToken)
  }
  const res = await fetch(c.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
  if (!res.ok) throw new DriveError(res.status, `Google would not sign in (${res.status}). Check the Google Drive settings.`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new DriveError(502, 'Google sent no access token')
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 })
  return data.access_token
}

async function call(c: DriveConfig, url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const token = await accessToken(c)
  const res = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } })
  if (res.status === 401) tokenCache.clear() // a stale token: the next call signs in again
  return res
}

const fail = async (res: Response, what: string): Promise<never> => {
  let detail = ''
  try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '' } catch { /* not JSON */ }
  throw new DriveError(res.status, `Google Drive refused to ${what} (${res.status}${detail ? `: ${detail}` : ''})`)
}

/** Saves a file in the Drive folder under the given name and returns its Drive file id. Uses a resumable upload, which suits any size. */
export async function drivePut(c: DriveConfig, name: string, data: Buffer): Promise<string> {
  const start = await call(c, `${c.apiBase}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(data.length) },
    body: JSON.stringify({ name, parents: [c.folderId] }),
  })
  if (!start.ok) return fail(start, 'start the upload')
  const location = start.headers.get('location')
  if (!location) throw new DriveError(502, 'Google Drive did not say where to send the file')
  const done = await fetch(location, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(data) })
  if (!done.ok) return fail(done, 'save the file')
  const id = ((await done.json()) as { id?: string }).id
  if (!id) throw new DriveError(502, 'Google Drive did not return the new file id')
  return id
}

const fileUrl = (c: DriveConfig, id: string, query: string) => `${c.apiBase}/drive/v3/files/${encodeURIComponent(id)}${query}`

export async function driveGet(c: DriveConfig, id: string): Promise<Buffer> {
  const res = await call(c, fileUrl(c, id, '?alt=media&supportsAllDrives=true'))
  if (!res.ok) return fail(res, 'read the file')
  return Buffer.from(await res.arrayBuffer())
}

export interface DriveFileMeta { name: string; mimeType: string; size: number | null }

export async function driveMeta(c: DriveConfig, id: string): Promise<DriveFileMeta> {
  const res = await call(c, fileUrl(c, id, '?fields=name,mimeType,size&supportsAllDrives=true'))
  if (!res.ok) return fail(res, 'look the file up')
  const j = (await res.json()) as { name?: string; mimeType?: string; size?: string }
  return { name: j.name ?? 'file', mimeType: j.mimeType ?? '', size: j.size ? Number(j.size) : null }
}

/** A Google Doc, Sheet or Slides file has no bytes of its own; this asks Google for a PDF copy of it. */
export async function driveExportPdf(c: DriveConfig, id: string): Promise<Buffer> {
  const res = await call(c, fileUrl(c, id, '/export?mimeType=application%2Fpdf'))
  if (!res.ok) return fail(res, 'turn the document into a PDF')
  return Buffer.from(await res.arrayBuffer())
}

/** Deleting something that is already gone is not an error. */
export async function driveDelete(c: DriveConfig, id: string): Promise<void> {
  const res = await call(c, fileUrl(c, id, '?supportsAllDrives=true'), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) return fail(res, 'delete the file')
}

export interface DriveAbout { email: string | null; limit: number | null; usage: number | null }

/** Whose Drive this is and how much room is used. `limit` is null when Google reports no limit (for example a shared drive). */
export async function driveAbout(c: DriveConfig): Promise<DriveAbout> {
  const res = await call(c, `${c.apiBase}/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)`)
  if (!res.ok) return fail(res, 'read the account details')
  const j = (await res.json()) as { user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } }
  return { email: j.user?.emailAddress ?? null, limit: j.storageQuota?.limit ? Number(j.storageQuota.limit) : null, usage: j.storageQuota?.usage ? Number(j.storageQuota.usage) : null }
}

export interface CheckStep { step: string; ok: boolean; ms: number; error?: string }

/** Tries the folder the way the app will use it: sign in, save a small file, read it back, delete it and confirm it is gone. */
export async function driveCheck(c: DriveConfig): Promise<CheckStep[]> {
  const steps: CheckStep[] = []
  const data = Buffer.from(`school platform drive check ${new Date().toISOString()}`)
  let id = ''
  const run = async (step: string, fn: () => Promise<void>) => {
    const t = Date.now()
    try { await fn(); steps.push({ step, ok: true, ms: Date.now() - t }) }
    catch (e) { steps.push({ step, ok: false, ms: Date.now() - t, error: (e as Error).message }) }
  }
  await run('sign in to Google', async () => { await accessToken(c) })
  await run('save a file in the folder', async () => { id = await drivePut(c, `_check-${randomUUID()}`, data) })
  await run('read it back and compare', async () => { if (!id) throw new Error('nothing was saved'); if (!(await driveGet(c, id)).equals(data)) throw new Error('the file that came back is different') })
  await run('delete it', async () => { if (id) await driveDelete(c, id) })
  await run('confirm it is gone', async () => {
    if (!id) return
    try { await driveGet(c, id) } catch (e) { if ((e as DriveError).status === 404) return; throw e }
    throw new Error('the file is still there after deleting it')
  })
  return steps
}

/** The Google sign-in this server offers schools ("Connect Google Drive"). Null until the server's owner creates the Google client. */
export function googleClient(env: Record<string, string | undefined> = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  const api = env.API_PUBLIC_URL?.replace(/\/+$/, '') || `http://localhost:${env.PORT ?? 4000}`
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_REDIRECT_URI?.trim() || `${api}/api/storage/drive/callback`,
    authUrl: env.GDRIVE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GDRIVE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    apiBase: (env.GDRIVE_API_BASE || 'https://www.googleapis.com').replace(/\/+$/, ''),
  }
}

/** The app only ever sees files it made itself (not the person's other Drive files). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export function googleAuthUrl(g: NonNullable<ReturnType<typeof googleClient>>, state: string) {
  const q = new URLSearchParams({ client_id: g.clientId, redirect_uri: g.redirectUri, response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent select_account', state })
  return `${g.authUrl}?${q}`
}

/** Swaps the one-time code Google sent back for a long-lived refresh token. */
export async function exchangeCode(g: NonNullable<ReturnType<typeof googleClient>>, code: string): Promise<string> {
  const form = new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: g.redirectUri, grant_type: 'authorization_code' })
  const res = await fetch(g.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
  if (!res.ok) throw new DriveError(res.status, `Google did not accept the sign-in (${res.status})`)
  const j = (await res.json()) as { refresh_token?: string }
  if (!j.refresh_token) throw new DriveError(502, 'Google gave no lasting access. Remove this app from your Google account permissions and connect again.')
  return j.refresh_token
}

/** Makes a folder in the signed-in person's Drive and returns its id. */
export async function driveCreateFolder(c: DriveConfig, name: string): Promise<string> {
  const res = await call(c, `${c.apiBase}/drive/v3/files?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!res.ok) return fail(res, 'create the folder')
  const id = ((await res.json()) as { id?: string }).id
  if (!id) throw new DriveError(502, 'Google Drive did not return the folder id')
  return id
}

/** The raw Drive response for a file, so large videos can be streamed (and seeked with Range) instead of held in memory. */
export async function driveStream(c: DriveConfig, id: string, range?: string): Promise<Response> {
  const res = await call(c, fileUrl(c, id, '?alt=media&supportsAllDrives=true'), range ? { headers: { range } } : {})
  if (!res.ok && res.status !== 206) return fail(res, 'read the file')
  return res
}

/** Tells Google to drop the app's access. Best effort: failing to reach Google must not stop a school disconnecting. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined)
}
