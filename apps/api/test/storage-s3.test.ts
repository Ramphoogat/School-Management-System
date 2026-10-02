import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signRequest } from '@dist/storage/s3'
import { deleteFile, getFile, newKey, putFile } from '@dist/storage/storage'
import { s3Config } from '@dist/storage/s3'
import { checkBucket, copyFolderToBucket } from '@dist/storage/tools'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('S3 request signing', () => {
  // The worked example in Amazon's own documentation ("Example: GET Object"), so this is checked against a published answer
  // and not only against this code.
  it('reproduces Amazon\'s published signature', () => {
    const h = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('encodes odd characters in the object name the way S3 expects', () => {
    const a = signRequest({ method: 'GET', url: 'https://b.s3.amazonaws.com/a b/c!d.txt', region: 'us-east-1', accessKeyId: 'K', secretAccessKey: 'S', now: new Date('2020-01-01T00:00:00Z') })
    const b = signRequest({ method: 'GET', url: 'https://b.s3.amazonaws.com/a%20b/c%21d.txt', region: 'us-east-1', accessKeyId: 'K', secretAccessKey: 'S', now: new Date('2020-01-01T00:00:00Z') })
    expect(a.authorization).toBe(b.authorization)
  })
})

describe('object storage as the file store', () => {
  const objects = new Map<string, Buffer>()
  const seen: { method: string; url: string; auth: string; hash: string }[] = []
  let server: Server
  const keep: Record<string, string | undefined> = {}
  const set = { S3_BUCKET: 'school-files', S3_ACCESS_KEY_ID: 'AKTEST', S3_SECRET_ACCESS_KEY: 'sekret', S3_REGION: 'auto', S3_PREFIX: 'prod', S3_FORCE_PATH_STYLE: 'true' }

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (d) => chunks.push(d))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), hash: String(req.headers['x-amz-content-sha256']) })
        if (!/^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(String(req.headers.authorization))) { res.statusCode = 403; return res.end() }
        if (req.method === 'PUT') { objects.set(req.url!, body); res.statusCode = 200; return res.end() }
        if (req.method === 'GET') { const o = objects.get(req.url!); res.statusCode = o ? 200 : 404; return res.end(o) }
        if (req.method === 'DELETE') { objects.delete(req.url!); res.statusCode = 204; return res.end() }
        res.statusCode = 405; res.end()
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    for (const k of [...Object.keys(set), 'S3_ENDPOINT']) keep[k] = process.env[k]
    Object.assign(process.env, set, { S3_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}` })
  })
  afterAll(async () => {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v)
    await new Promise((r) => server.close(r))
  })

  it('stores, reads back and deletes a file through the bucket, signed on every request', async () => {
    const key = newKey()
    const data = Buffer.from('%PDF-1.4 hello')
    await putFile(key, data)
    expect(objects.get(`/school-files/prod/${key}`)?.equals(data)).toBe(true)
    expect((await getFile(key)).equals(data)).toBe(true)
    await deleteFile(key)
    expect(objects.size).toBe(0)
    await expect(getFile(key)).rejects.toThrow(/404/)
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'GET', 'DELETE', 'GET'])
    expect(seen.every((s) => s.auth.startsWith('AWS4-HMAC-SHA256'))).toBe(true)
    // The signature covers the real file content.
    expect(seen[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(seen[0].hash).not.toBe(seen[1].hash)
  })

  it('the bucket check saves, reads, deletes and confirms, and leaves nothing behind', async () => {
    const steps = await checkBucket(s3Config()!)
    expect(steps.map((s) => [s.step, s.ok])).toEqual([['save a file', true], ['read it back and compare', true], ['delete it', true], ['confirm it is gone', true]])
    expect([...objects.keys()].filter((k) => k.includes('_check/'))).toEqual([])
  })

  it('the bucket check names the step that fails', async () => {
    const good = process.env.S3_ACCESS_KEY_ID
    process.env.S3_ACCESS_KEY_ID = 'wrong-key'
    const steps = await checkBucket(s3Config()!)
    process.env.S3_ACCESS_KEY_ID = good
    expect(steps[0]).toMatchObject({ step: 'save a file', ok: false })
    expect(steps[0].error).toMatch(/403/)
  })

  it('copies a folder of existing files into the bucket under the same names, and leaves the originals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uploads-'))
    try {
      await mkdir(join(dir, 'subfolder'))
      await writeFile(join(dir, 'a1b2-file-one'), Buffer.from('one'))
      await writeFile(join(dir, 'c3d4-file-two'), Buffer.alloc(5000, 7))
      await writeFile(join(dir, '.gitkeep'), 'ignored')
      const dry = await copyFolderToBucket(dir, s3Config()!, { dryRun: true })
      expect(dry).toMatchObject({ found: 2, copied: 0, dryRun: true })
      expect([...objects.keys()].some((k) => k.includes('a1b2-file-one'))).toBe(false)

      const r = await copyFolderToBucket(dir, s3Config()!)
      expect(r).toMatchObject({ found: 2, copied: 2, bytes: 5003, failed: [] })
      expect(objects.get('/school-files/prod/a1b2-file-one')?.toString()).toBe('one')
      expect(objects.get('/school-files/prod/c3d4-file-two')?.length).toBe(5000)
      expect((await getFile('a1b2-file-one')).toString()).toBe('one') // the app can now read it through the bucket

      const again = await copyFolderToBucket(dir, s3Config()!) // safe to repeat
      expect(again).toMatchObject({ found: 2, copied: 2, failed: [] })
      objects.delete('/school-files/prod/a1b2-file-one'); objects.delete('/school-files/prod/c3d4-file-two')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('reports the files it could not copy and carries on with the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uploads-'))
    const good = process.env.S3_ACCESS_KEY_ID
    try {
      await writeFile(join(dir, 'x1'), Buffer.from('x'))
      process.env.S3_ACCESS_KEY_ID = 'nope'
      const r = await copyFolderToBucket(dir, s3Config()!)
      expect(r.copied).toBe(0)
      expect(r.failed).toHaveLength(1)
      expect(r.failed[0]).toMatchObject({ name: 'x1' })
    } finally { process.env.S3_ACCESS_KEY_ID = good; await rm(dir, { recursive: true, force: true }) }
  })

  it('deleting a file that is not there is fine', async () => {
    await expect(deleteFile(newKey())).resolves.toBeUndefined()
  })

  it('reports a refusal from the bucket instead of pretending the file was saved', async () => {
    process.env.S3_SECRET_ACCESS_KEY = 'sekret'
    const bad = process.env.S3_ACCESS_KEY_ID
    process.env.S3_ACCESS_KEY_ID = 'someone-else'
    await expect(putFile(newKey(), Buffer.from('x'))).rejects.toThrow(/403/)
    process.env.S3_ACCESS_KEY_ID = bad
  })
})

describe('without a bucket configured', () => {
  it('keeps using the disk folder', async () => {
    expect(process.env.S3_BUCKET).toBeUndefined()
    const key = newKey()
    await putFile(key, Buffer.from('on disk'))
    expect((await getFile(key)).toString()).toBe('on disk')
    await deleteFile(key)
    await expect(getFile(key)).rejects.toThrow()
  })
})
