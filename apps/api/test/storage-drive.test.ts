import { INestApplication } from '@nestjs/common'
import { createServer, type Server } from 'node:http'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DriveError, driveAbout, driveCheck, driveConfig, driveDelete, driveExportPdf, driveGet, driveMeta, drivePut, driveShareEmail } from '@dist/storage/drive'
import { clients, createApp, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

// ---- a stand-in for Google: the sign-in endpoint and the parts of the Drive API the app uses
interface Rec { id: string; name: string; parents: string[]; data: Buffer; mimeType: string }
const files = new Map<string, Rec>()
const sessions = new Map<string, { name: string; parents: string[] }>()
let server: Server
let origin = ''
let counter = 0
let tokenCalls = 0
let lastForm = new URLSearchParams()
let rejectSignIn = false
let failUploads = false

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const EMAIL = 'robot@school-proj.iam.gserviceaccount.com'
const SA_JSON = JSON.stringify({ client_email: EMAIL, private_key: privateKey })
const PDF = (n = 40) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n, 65)])

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const url = new URL(req.url ?? '/', 'http://x')
      const json = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

      if (url.pathname === '/token' && req.method === 'POST') {
        tokenCalls++
        lastForm = new URLSearchParams(body.toString())
        return rejectSignIn ? json(400, { error: 'invalid_grant' }) : json(200, { access_token: `tok-${tokenCalls}`, expires_in: 3600 })
      }
      // The upload session address carries its own permission, like Google's.
      if (url.pathname.startsWith('/session/') && req.method === 'PUT') {
        const meta = sessions.get(url.pathname.split('/')[2])
        if (!meta) return json(404, { error: { message: 'no such upload' } })
        const id = `drv${++counter}`
        files.set(id, { id, name: meta.name, parents: meta.parents, data: body, mimeType: 'application/octet-stream' })
        return json(200, { id })
      }
      if (!String(req.headers.authorization).startsWith('Bearer tok-')) return json(401, { error: { message: 'sign in first' } })

      if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        if (failUploads) return json(403, { error: { message: 'The user\'s Drive storage quota has been exceeded.' } })
        const sid = `s${++counter}`
        sessions.set(sid, JSON.parse(body.toString()))
        res.writeHead(200, { location: `${origin}/session/${sid}` })
        return res.end()
      }
      if (url.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: EMAIL }, storageQuota: { limit: '16106127360', usage: '2048' } })
      const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/)
      if (m) {
        const rec = files.get(decodeURIComponent(m[1]))
        if (!rec) return json(404, { error: { message: 'File not found' } })
        if (req.method === 'DELETE') { files.delete(rec.id); res.writeHead(204); return res.end() }
        if (m[2]) { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(Buffer.concat([Buffer.from('%PDF-1.4\nexport of '), Buffer.from(rec.name)])) }
        if (url.searchParams.get('alt') === 'media') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(rec.data) }
        return json(200, { name: rec.name, mimeType: rec.mimeType, size: String(rec.data.length) })
      }
      return json(404, { error: { message: 'unknown' } })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { await new Promise((r) => server.close(r)) })

const env = (extra: Record<string, string> = {}) => ({ GDRIVE_FOLDER_ID: 'folder1', GDRIVE_API_BASE: origin, GDRIVE_TOKEN_URL: `${origin}/token`, GDRIVE_SERVICE_ACCOUNT_JSON: SA_JSON, ...extra })

describe('driveConfig', () => {
  it('needs a folder and one way to sign in', () => {
    expect(driveConfig({})).toBeNull()
    expect(driveConfig({ GDRIVE_SERVICE_ACCOUNT_JSON: SA_JSON })).toBeNull() // no folder
    expect(driveConfig({ GDRIVE_FOLDER_ID: 'f' })).toBeNull() // no sign-in
    expect(driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_SERVICE_ACCOUNT_JSON: 'not json' })).toBeNull()
    expect(driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b' }) })).toBeNull() // no key
  })
  it('reads a service account (whole file, or email and key) and a personal sign-in', () => {
    const a = driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_SERVICE_ACCOUNT_JSON: SA_JSON })!
    expect(a.auth).toMatchObject({ type: 'service', email: EMAIL })
    expect(driveShareEmail(a)).toBe(EMAIL)
    const b = driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_CLIENT_EMAIL: EMAIL, GDRIVE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') })!
    expect(b.auth).toMatchObject({ type: 'service', email: EMAIL })
    expect((b.auth as { privateKey: string }).privateKey).toContain('\n') // the \n written in .env became real line breaks
    const c = driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_CLIENT_ID: 'id', GDRIVE_CLIENT_SECRET: 's', GDRIVE_REFRESH_TOKEN: 'r' })!
    expect(c.auth).toMatchObject({ type: 'oauth', clientId: 'id' })
    expect(driveShareEmail(c)).toBeNull()
    expect(driveConfig({ GDRIVE_FOLDER_ID: 'f', GDRIVE_SERVICE_ACCOUNT_JSON: SA_JSON })!.apiBase).toBe('https://www.googleapis.com')
  })
})

describe('the Drive client', () => {
  const cfg = () => driveConfig(env())!

  it('signs in with a properly signed service-account token, and reuses it', async () => {
    const before = tokenCalls
    await drivePut(cfg(), 'k-sign', PDF())
    await drivePut(cfg(), 'k-sign-2', PDF())
    expect(tokenCalls - before).toBeLessThanOrEqual(1) // one sign-in serves both
    expect(lastForm.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, c, s] = lastForm.get('assertion')!.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({ iss: EMAIL, scope: 'https://www.googleapis.com/auth/drive', aud: `${origin}/token` })
    expect(claims.exp - claims.iat).toBe(3600)
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true) // Google could verify it
  })

  it('saves, reads, looks up and deletes a file in the folder', async () => {
    const data = PDF(500)
    const id = await drivePut(cfg(), 'key-123', data)
    expect(files.get(id)).toMatchObject({ name: 'key-123', parents: ['folder1'] })
    expect((await driveGet(cfg(), id)).equals(data)).toBe(true)
    expect(await driveMeta(cfg(), id)).toEqual({ name: 'key-123', mimeType: 'application/octet-stream', size: data.length })
    await driveDelete(cfg(), id)
    expect(files.has(id)).toBe(false)
    await expect(driveGet(cfg(), id)).rejects.toMatchObject({ status: 404 })
    await expect(driveDelete(cfg(), id)).resolves.toBeUndefined() // deleting what is gone is fine
  })

  it('exports a Google Doc as a PDF', async () => {
    const id = await drivePut(cfg(), 'a-doc', Buffer.from('x'))
    files.get(id)!.mimeType = 'application/vnd.google-apps.document'
    expect((await driveExportPdf(cfg(), id)).toString()).toContain('%PDF-1.4')
  })

  it('reports whose Drive it is and how much room is used', async () => {
    expect(await driveAbout(cfg())).toEqual({ email: EMAIL, limit: 16106127360, usage: 2048 })
  })

  it('runs the whole check, and names the step that fails', async () => {
    const steps = await driveCheck(cfg())
    expect(steps.map((s) => [s.step, s.ok])).toEqual([['sign in to Google', true], ['save a file in the folder', true], ['read it back and compare', true], ['delete it', true], ['confirm it is gone', true]])
    failUploads = true
    try {
      const bad = await driveCheck(cfg())
      expect(bad.find((s) => s.step === 'save a file in the folder')).toMatchObject({ ok: false })
      expect(bad.find((s) => s.step === 'save a file in the folder')!.error).toMatch(/storage quota has been exceeded/)
    } finally { failUploads = false }
  })

  it('says so when Google will not sign in', async () => {
    rejectSignIn = true
    try {
      // a different account name, so the cached sign-in from the other tests is not used
      const other = driveConfig(env({ GDRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'other@x.iam.gserviceaccount.com', private_key: privateKey }) }))!
      await expect(drivePut(other, 'k', PDF())).rejects.toThrow(/would not sign in/)
      await expect(drivePut(other, 'k', PDF())).rejects.toBeInstanceOf(DriveError)
    } finally { rejectSignIn = false }
  })

  it('signs in with a refresh token for a personal account', async () => {
    const c = driveConfig(env({ GDRIVE_SERVICE_ACCOUNT_JSON: '', GDRIVE_CLIENT_ID: 'cid', GDRIVE_CLIENT_SECRET: 'sec', GDRIVE_REFRESH_TOKEN: 'ref' }))!
    expect(c.auth.type).toBe('oauth')
    await drivePut(c, 'k-oauth', PDF())
    expect(lastForm.get('grant_type')).toBe('refresh_token')
    expect(lastForm.get('refresh_token')).toBe('ref')
    expect(lastForm.get('client_id')).toBe('cid')
  })
})

// ---- through the app: where new files go
let app: INestApplication
let w: World
let wb: World
let c: Awaited<ReturnType<typeof clients>>
let cb: Awaited<ReturnType<typeof clients>>
const saved: Record<string, string | undefined> = {}
const KEYS = ['GDRIVE_FOLDER_ID', 'GDRIVE_API_BASE', 'GDRIVE_TOKEN_URL', 'GDRIVE_SERVICE_ACCOUNT_JSON', 'STORAGE_PRIMARY_LIMIT_GB', 'UPLOAD_DIR']

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k]
  Object.assign(process.env, env())
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  wb = await seedWorld('B')
  c = await clients(app, 'a')
  cb = await clients(app, 'b')
})
afterAll(async () => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  await app.close()
  await prisma.$disconnect()
})
afterEach(() => { delete process.env.STORAGE_PRIMARY_LIMIT_GB; failUploads = false })

const http = () => request(app.getHttpServer())
const bearer = (who: Client) => ({ authorization: `Bearer ${who.token}` })
const upload = (who: Client, data = PDF(), name = 'file.pdf') => http().post('/api/documents').set(bearer(who)).attach('file', data, name)
const objectFor = async (docId: string) => prisma.storageObject.findUnique({ where: { key: (await prisma.schoolDocument.findUniqueOrThrow({ where: { id: docId } })).storageKey } })
const setMode = (who: Client, mode: string) => who.put('/storage/mode', { mode })
const read = (who: Client, docId: string) => http().get(`/api/documents/${docId}/file`).set(bearer(who)).buffer(true).parse((res, cb2) => { const ch: Buffer[] = []; res.on('data', (d) => ch.push(d)); res.on('end', () => cb2(null, Buffer.concat(ch))) })

describe('automatic: the main storage first', () => {
  it('keeps new files in the main storage while it has room, and counts them', async () => {
    const data = PDF(300)
    const r = await upload(c.clerk, data)
    expect(r.status).toBe(201)
    const o = await objectFor(r.body.id)
    expect(o).toMatchObject({ backend: 'primary', remoteId: null, size: data.length, schoolId: w.schoolId })
    expect(files.size).toBeGreaterThanOrEqual(0)
    const status = (await c.clerk.get('/storage')).body
    expect(status).toMatchObject({ mode: 'auto', activeNow: 'primary', reason: 'auto-main' })
    expect(status.main.usedBytes).toBeGreaterThanOrEqual(data.length)
    expect(status.main.schoolFiles).toBeGreaterThanOrEqual(1)
  })

  it('switches to Google Drive by itself once the main storage is over its limit, and the file can still be read and deleted', async () => {
    process.env.STORAGE_PRIMARY_LIMIT_GB = '0.000001' // about 1 KB: already used up
    const data = PDF(2000)
    const r = await upload(c.clerk, data, 'big.pdf')
    expect(r.status).toBe(201)
    const o = await objectFor(r.body.id)
    expect(o).toMatchObject({ backend: 'drive', size: data.length, schoolId: w.schoolId })
    expect(o!.remoteId).toBeTruthy()
    expect(files.get(o!.remoteId!)).toMatchObject({ name: (await prisma.schoolDocument.findUniqueOrThrow({ where: { id: r.body.id } })).storageKey, parents: ['folder1'] })

    const status = (await c.principal.get('/storage')).body
    expect(status).toMatchObject({ activeNow: 'drive', reason: 'auto-main-full' })
    expect(status.drive).toMatchObject({ configured: true, shareWith: EMAIL, account: EMAIL, schoolFiles: 1 })

    const dl = await read(c.student, r.body.id) // everyone in the school reads it as usual, wherever it is kept
    expect(dl.status).toBe(200)
    expect(Buffer.compare(dl.body, data)).toBe(0)

    expect((await http().delete(`/api/documents/${r.body.id}`).set(bearer(c.clerk))).status).toBe(200)
    expect(files.has(o!.remoteId!)).toBe(false)
    expect(await prisma.storageObject.findUnique({ where: { key: o!.key } })).toBeNull()
  })

  it('switches to Google Drive when the main storage refuses the file, and not in the "main storage only" mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blocker-'))
    const blocker = join(dir, 'a-file-not-a-folder')
    await writeFile(blocker, 'x')
    const keep = process.env.UPLOAD_DIR
    process.env.UPLOAD_DIR = blocker // a folder cannot be made here, so the main storage fails
    try {
      const r = await upload(c.clerk, PDF(100), 'fallback.pdf')
      expect(r.status).toBe(201)
      expect((await objectFor(r.body.id))!.backend).toBe('drive')

      expect((await setMode(c.principal, 'primary')).status).toBe(200)
      const refused = await upload(c.clerk, PDF(100), 'refused.pdf')
      expect(refused.status).toBeGreaterThanOrEqual(500) // the person said main storage only, so it is not quietly sent elsewhere
      expect(await prisma.schoolDocument.count({ where: { name: 'refused.pdf' } })).toBe(0)
    } finally {
      await setMode(c.principal, 'auto')
      if (keep === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = keep
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('choosing by hand', () => {
  it('"main storage only" stays on the main storage even when it is full, and "Google Drive only" always uses Drive', async () => {
    process.env.STORAGE_PRIMARY_LIMIT_GB = '0.000001'
    expect((await setMode(c.clerk, 'primary')).status).toBe(200)
    const a = await upload(c.clerk, PDF(2000), 'main-only.pdf')
    expect((await objectFor(a.body.id))!.backend).toBe('primary')
    expect((await c.clerk.get('/storage')).body).toMatchObject({ mode: 'primary', activeNow: 'primary', reason: 'chosen-main' })

    delete process.env.STORAGE_PRIMARY_LIMIT_GB // plenty of room, but Drive is what was chosen
    expect((await setMode(c.admin, 'drive')).status).toBe(200)
    const b = await upload(c.clerk, PDF(100), 'drive-only.pdf')
    expect((await objectFor(b.body.id))!.backend).toBe('drive')
    expect((await c.principal.get('/storage')).body).toMatchObject({ mode: 'drive', activeNow: 'drive', reason: 'chosen-drive' })

    expect((await setMode(c.principal, 'auto')).body.mode).toBe('auto')
  })

  it('clerk, principal and admin can look and change; nobody else can', async () => {
    for (const r of ['student', 'parent', 'teacher', 'teacher2'] as const) {
      expect((await c[r].get('/storage')).status, `${r} look`).toBe(403)
      expect((await setMode(c[r], 'drive')).status, `${r} change`).toBe(403)
      expect((await c[r].post('/storage/check')).status, `${r} test`).toBe(403)
    }
    for (const r of ['clerk', 'principal', 'admin'] as const) {
      expect((await c[r].get('/storage')).status, `${r} look`).toBe(200)
      expect((await setMode(c[r], 'auto')).status, `${r} change`).toBe(200)
    }
    expect((await http().get('/api/storage')).status).toBe(401)
  })

  it('refuses an unknown mode, and records each change', async () => {
    for (const bad of ['', 'cloud', 'DRIVE', 5, null]) expect((await c.admin.put('/storage/mode', { mode: bad as never })).status, String(bad)).toBe(400)
    await setMode(c.admin, 'primary')
    await setMode(c.admin, 'auto')
    const log = await prisma.auditLog.findMany({ where: { action: 'storage.mode_changed', schoolId: w.schoolId, actorId: w.u.admin }, orderBy: { createdAt: 'desc' }, take: 2 })
    expect(log[0].meta).toEqual({ from: 'primary', to: 'auto' })
    expect(log[1].meta).toMatchObject({ to: 'primary' })
  })

  it('each school chooses for itself', async () => {
    expect((await setMode(c.admin, 'drive')).status).toBe(200)
    expect((await cb.admin.get('/storage')).body.mode).toBe('auto')
    const b = await upload(cb.clerk, PDF(100), 'school-b.pdf')
    expect((await objectFor(b.body.id))!.backend).toBe('primary')
    expect((await objectFor(b.body.id))!.schoolId).toBe(wb.schoolId)
    await setMode(c.admin, 'auto')
  })

  it('cannot choose Google Drive when it is not connected, and says so on the screen', async () => {
    const folder = process.env.GDRIVE_FOLDER_ID
    delete process.env.GDRIVE_FOLDER_ID
    try {
      const r = await setMode(c.admin, 'drive')
      expect(r.status).toBe(400)
      expect(r.body.message).toMatch(/not connected/i)
      const status = (await c.admin.get('/storage')).body
      expect(status.drive.configured).toBe(false)
      expect(status.reason).toBe('drive-not-set-up')
      // With Drive off, a file still just goes to the main storage, whatever the old setting was.
      const r2 = await upload(c.clerk, PDF(100), 'no-drive.pdf')
      expect(r2.status).toBe(201)
      expect((await objectFor(r2.body.id))!.backend).toBe('primary')
    } finally { process.env.GDRIVE_FOLDER_ID = folder }
  })
})

describe('what stays where it is', () => {
  it('a failing Drive upload is an error, not a silent loss', async () => {
    await setMode(c.admin, 'drive')
    failUploads = true
    const before = await prisma.schoolDocument.count()
    const r = await upload(c.clerk, PDF(100), 'quota.pdf')
    expect(r.status).toBeGreaterThanOrEqual(500)
    expect(await prisma.schoolDocument.count()).toBe(before)
    await setMode(c.admin, 'auto')
  })

  it('school logos always stay in the main storage (they are shown on the public sign-in page)', async () => {
    await setMode(c.admin, 'drive')
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
    const r = await http().put('/api/school/logo').set(bearer(c.admin)).attach('file', PNG, 'logo.png')
    expect(r.status).toBe(200)
    const school = await prisma.school.findUniqueOrThrow({ where: { id: w.schoolId } })
    expect((await prisma.storageObject.findUnique({ where: { key: school.logoKey! } }))!.backend).toBe('primary')
    await setMode(c.admin, 'auto')
  })

  it('a file stored before this existed (no record) is still found in the main storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legacy-'))
    const keep = process.env.UPLOAD_DIR
    process.env.UPLOAD_DIR = dir
    try {
      await writeFile(join(dir, 'legacy-key'), PDF(60))
      const doc = await prisma.schoolDocument.create({ data: { schoolId: w.schoolId, uploadedById: w.u.clerk, title: 'Old', name: 'old.pdf', mime: 'application/pdf', size: 69, storageKey: 'legacy-key' } })
      const dl = await read(c.student, doc.id)
      expect(dl.status).toBe(200)
      expect(Buffer.compare(dl.body, PDF(60))).toBe(0)
    } finally {
      if (keep === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = keep
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the test button tries both places and reports each step', async () => {
    const r = await c.clerk.post('/storage/check')
    expect(r.status).toBe(201)
    expect(r.body.main.steps.every((s: { ok: boolean }) => s.ok)).toBe(true)
    expect(r.body.drive.steps).toHaveLength(5)
    expect(r.body.drive.steps.every((s: { ok: boolean }) => s.ok)).toBe(true)
  })
})
