import { INestApplication } from '@nestjs/common'
import { createServer, type Server } from 'node:http'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LinkError, resolveLink } from '@dist/import/link-sources'
import { allowPrivateNetworksForTests, downloadUrl, filenameFrom, isBlockedAddress } from '@dist/import/link-fetch'
import { clients, createApp, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

const PDF = Buffer.from('%PDF-1.4\nthe school timetable')
const ID = 'AbCdEfGhIjKlMnOpQrStUv123456'

describe('resolveLink: which address a pasted link really downloads from', () => {
  it('reads every kind of Google Drive file link', () => {
    for (const link of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/u/0/d/${ID}/view`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?export=download&id=${ID}`,
    ]) {
      const r = resolveLink(link)
      expect(r.kind, link).toBe('gdrive')
      expect(r.driveFileId, link).toBe(ID)
      expect(r.fetchUrl, link).toContain(`id=${ID}`)
    }
  })

  it('says what is wrong with a Drive folder or a Drive link with no file', () => {
    expect(() => resolveLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toThrow(/folder/i)
    expect(() => resolveLink('https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp')).toThrow(/folder/i)
    expect(() => resolveLink('https://drive.google.com/')).toThrow(/Could not find a file/)
  })

  it('turns Google Docs, Sheets and Slides into PDF exports', () => {
    expect(resolveLink(`https://docs.google.com/document/d/${ID}/edit`)).toMatchObject({ kind: 'gdoc', driveFileId: ID, fetchUrl: `https://docs.google.com/document/d/${ID}/export?format=pdf`, nameHint: 'document.pdf' })
    expect(resolveLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`).fetchUrl).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=pdf`)
    expect(resolveLink(`https://docs.google.com/presentation/d/${ID}/edit`).fetchUrl).toBe(`https://docs.google.com/presentation/d/${ID}/export/pdf`)
    expect(() => resolveLink('https://docs.google.com/forms/d/e/1FAIpQLSdxxxxxxxx/viewform')).toThrow(/not a Doc, Sheet or Slides/)
  })

  it('makes Dropbox, OneDrive, SharePoint and GitHub links into downloads', () => {
    const dropbox = resolveLink('https://www.dropbox.com/s/abc123/notes.pdf?dl=0')
    expect(dropbox.kind).toBe('dropbox')
    expect(new URL(dropbox.fetchUrl).searchParams.get('dl')).toBe('1')

    const share = 'https://1drv.ms/b/s!AbCdEf'
    const onedrive = resolveLink(share)
    expect(onedrive.kind).toBe('onedrive')
    expect(onedrive.fetchUrl).toBe(`https://api.onedrive.com/v1.0/shares/u!${Buffer.from(share).toString('base64url')}/root/content`)
    const encoded = onedrive.fetchUrl.split('/shares/u!')[1].split('/root')[0]
    expect(encoded).not.toMatch(/[=+/]/) // base64url: no padding, no + and no /

    const sp = resolveLink('https://contoso-my.sharepoint.com/:b:/g/personal/x/EAbc?e=1')
    expect(sp.kind).toBe('onedrive')
    expect(new URL(sp.fetchUrl).searchParams.get('download')).toBe('1')

    expect(resolveLink('https://github.com/owner/repo/blob/main/docs/guide.pdf')).toMatchObject({ kind: 'github', fetchUrl: 'https://raw.githubusercontent.com/owner/repo/main/docs/guide.pdf' })
  })

  it('treats any other web address as a direct link, and refuses things that are not links', () => {
    expect(resolveLink('https://example.com/files/timetable.pdf')).toMatchObject({ kind: 'direct', fetchUrl: 'https://example.com/files/timetable.pdf' })
    expect(() => resolveLink('')).toThrow(/Paste a link/)
    expect(() => resolveLink('timetable.pdf')).toThrow(/web link/)
    expect(() => resolveLink('ftp://example.com/a.pdf')).toThrow(/https/)
    expect(() => resolveLink('file:///etc/passwd')).toThrow(/https/)
    expect(() => resolveLink('javascript:alert(1)')).toThrow(/https/)
    expect(() => resolveLink('https://user:secret@example.com/a.pdf')).toThrow(/username or password/)
    expect(() => resolveLink(`https://example.com/${'a'.repeat(2100)}`)).toThrow(/too long/)
    expect(() => resolveLink('https://example.com/a.pdf')).not.toThrow(LinkError)
  })
})

describe('addresses that must never be fetched', () => {
  it('blocks this machine, the local network, link-local (cloud metadata) and carrier-grade space', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1', 'not-an-ip']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })
  it('lets public addresses through', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isBlockedAddress(ip), ip).toBe(false)
  })
})

describe('filenameFrom', () => {
  it('reads plain, quoted and UTF-8 names from a Content-Disposition header', () => {
    expect(filenameFrom('attachment; filename="report card.pdf"')).toBe('report card.pdf')
    expect(filenameFrom('attachment; filename=notes.pdf')).toBe('notes.pdf')
    expect(filenameFrom("attachment; filename*=UTF-8''na%C3%AFve%20caf%C3%A9.pdf")).toBe('naïve café.pdf')
    expect(filenameFrom(undefined)).toBeNull()
    expect(filenameFrom('inline')).toBeNull()
  })
})

// ---- a small web server on this machine to download from
let site: Server
let base: string
let hits: string[]
beforeAll(async () => {
  site = createServer((req, res) => {
    hits.push(req.url ?? '')
    const send = (status: number, type: string, body: Buffer | string, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': type, ...headers }); res.end(body) }
    switch (req.url) {
      case '/files/timetable.pdf': return send(200, 'application/pdf', PDF)
      case '/redirect': return send(302, 'text/plain', '', { location: '/files/timetable.pdf' })
      case '/loop': return send(302, 'text/plain', '', { location: '/loop' })
      case '/noext': return send(200, 'application/pdf', PDF)
      case '/named': return send(200, 'application/octet-stream', PDF, { 'content-disposition': "attachment; filename*=UTF-8''Term%201%20Plan.pdf" })
      case '/page': return send(200, 'text/html; charset=utf-8', '<html><body>Please sign in</body></html>')
      case '/forbidden': return send(403, 'text/plain', 'no')
      case '/missing': return send(404, 'text/plain', 'no')
      case '/broken': return send(500, 'text/plain', 'no')
      case '/big': return send(200, 'application/pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(5000)]))
      case '/notes.txt': return send(200, 'text/plain', 'plain notes')
      case '/program.pdf': return send(200, 'application/pdf', Buffer.from('MZ this is not a pdf'))
      case '/weird.xyz': return send(200, 'application/octet-stream', Buffer.from('data'))
      default: return send(404, 'text/plain', 'no')
    }
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
afterAll(async () => { allowPrivateNetworksForTests(false); await new Promise((r) => site.close(r)) })
afterEach(() => { allowPrivateNetworksForTests(false) })
const reset = () => { hits = [] }

describe('downloadUrl', () => {
  it('refuses to connect to this machine or the local network unless a test allows it', async () => {
    reset()
    await expect(downloadUrl(`${base}/files/timetable.pdf`, { maxBytes: 1e6 })).rejects.toThrow(/private or internal/)
    await expect(downloadUrl(`http://localhost:${new URL(base).port}/files/timetable.pdf`, { maxBytes: 1e6 })).rejects.toThrow(/private or internal/)
    await expect(downloadUrl('http://169.254.169.254/latest/meta-data/', { maxBytes: 1e6 })).rejects.toThrow(/private or internal/)
    await expect(downloadUrl('http://[::1]:80/x', { maxBytes: 1e6 })).rejects.toThrow(/private or internal/)
    expect(hits).toEqual([]) // nothing was even requested
  })

  it('downloads a file and reports its type', async () => {
    allowPrivateNetworksForTests()
    const d = await downloadUrl(`${base}/files/timetable.pdf`, { maxBytes: 1e6 })
    expect(d.buffer.equals(PDF)).toBe(true)
    expect(d.contentType).toBe('application/pdf')
    expect(d.filename).toBeNull()
  })

  it('follows redirects, but not forever', async () => {
    allowPrivateNetworksForTests()
    expect((await downloadUrl(`${base}/redirect`, { maxBytes: 1e6 })).buffer.equals(PDF)).toBe(true)
    await expect(downloadUrl(`${base}/loop`, { maxBytes: 1e6 })).rejects.toThrow(/too many times/)
  })

  it('reads the file name the site suggests', async () => {
    allowPrivateNetworksForTests()
    expect((await downloadUrl(`${base}/named`, { maxBytes: 1e6 })).filename).toBe('Term 1 Plan.pdf')
  })

  it('says why a download failed', async () => {
    allowPrivateNetworksForTests()
    await expect(downloadUrl(`${base}/forbidden`, { maxBytes: 1e6 })).rejects.toThrow(/sign-in or permission/)
    await expect(downloadUrl(`${base}/missing`, { maxBytes: 1e6 })).rejects.toThrow(/no file at that link/)
    await expect(downloadUrl(`${base}/broken`, { maxBytes: 1e6 })).rejects.toThrow(/error \(500\)/)
  })

  it('stops a file that is bigger than the limit', async () => {
    allowPrivateNetworksForTests()
    await expect(downloadUrl(`${base}/big`, { maxBytes: 1000 })).rejects.toThrow(/bigger than/)
    expect((await downloadUrl(`${base}/big`, { maxBytes: 10_000 })).buffer.length).toBe(5004)
  })
})

// ---- through the real endpoints
let app: INestApplication
let w: World
let c: Awaited<ReturnType<typeof clients>>
let assignmentId: string

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A')
  c = await clients(app, 'a')
  assignmentId = (await prisma.assignment.create({ data: { schoolId: w.schoolId, classId: w.classA, title: 'Fractions', description: '', dueDate: new Date('2099-01-01'), createdById: w.u.teacher } })).id
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

const http = () => request(app.getHttpServer())
const bearer = (who: Client) => ({ authorization: `Bearer ${who.token}` })
const addDocument = (who: Client, url: string, title?: string) => http().post('/api/documents').set(bearer(who)).send({ url, ...(title ? { title } : {}) })

describe('adding a school document from a link', () => {
  it('fetches the file, stores it like an upload, names it from the link and records who added it', async () => {
    allowPrivateNetworksForTests()
    const r = await addDocument(c.clerk, `${base}/files/timetable.pdf`, 'Term timetable')
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ title: 'Term timetable', name: 'timetable.pdf', size: PDF.length, uploadedBy: 'clerk' })
    const row = await prisma.schoolDocument.findUniqueOrThrow({ where: { id: r.body.id } })
    expect(row).toMatchObject({ mime: 'application/pdf', size: PDF.length, uploadedById: w.u.clerk })
    // Anyone in the school can then download it exactly as if it had been uploaded.
    const dl = await http().get(`/api/documents/${r.body.id}/file`).set(bearer(c.student)).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))) })
    expect(dl.status).toBe(200)
    expect(Buffer.compare(dl.body, PDF)).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'document.uploaded', resourceId: r.body.id } })).toBe(1)
  })

  it('works through a redirect, with a name from the site, from a file with no extension, and for plain text', async () => {
    allowPrivateNetworksForTests()
    expect((await addDocument(c.principal, `${base}/redirect`)).body.name).toBe('timetable.pdf')
    expect((await addDocument(c.principal, `${base}/named`)).body.name).toBe('Term 1 Plan.pdf')
    expect((await addDocument(c.principal, `${base}/noext`)).body.name).toBe('noext.pdf') // the type came from the site
    expect((await addDocument(c.admin, `${base}/notes.txt`)).body.name).toBe('notes.txt')
  })

  it('only the people who may publish documents; students and parents never', async () => {
    allowPrivateNetworksForTests()
    reset()
    for (const r of ['student', 'parent', 'teacher'] as const) expect((await addDocument(c[r], `${base}/files/timetable.pdf`)).status, r).toBe(403)
    expect(hits).toEqual([]) // refused before anything was fetched
  })

  it('refuses links that are not a usable file, with a reason', async () => {
    allowPrivateNetworksForTests()
    const bad = async (path: string) => (await addDocument(c.clerk, `${base}${path}`)).body.message as string
    expect(await bad('/page')).toMatch(/web page, not a file/)
    expect(await bad('/forbidden')).toMatch(/sign-in or permission/)
    expect(await bad('/missing')).toMatch(/no file at that link/)
    expect(await bad('/program.pdf')).toMatch(/not an allowed file/)
    expect(await bad('/weird.xyz')).toMatch(/Could not tell what kind of file/)
    expect((await addDocument(c.clerk, 'not a link')).status).toBe(400)
    expect((await addDocument(c.clerk, 'ftp://example.com/a.pdf')).status).toBe(400)
    expect(await prisma.schoolDocument.count({ where: { name: { in: ['page', 'program.pdf', 'weird.xyz'] } } })).toBe(0)
  })

  it('never fetches a private address for a real person either', async () => {
    const r = await addDocument(c.clerk, `${base}/files/timetable.pdf`) // the test server is on this machine
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/private or internal/)
  })

  it('an uploaded file still wins over a link sent with it', async () => {
    allowPrivateNetworksForTests()
    reset()
    const r = await http().post('/api/documents').set(bearer(c.clerk)).field('url', `${base}/files/timetable.pdf`).attach('file', Buffer.from('%PDF-1.4\nuploaded'), 'mine.pdf')
    expect(r.status).toBe(201)
    expect(r.body.name).toBe('mine.pdf')
    expect(hits).toEqual([])
  })
})

describe('the other places that take files', () => {
  it('class resources: the class teacher can add from a link, another class\'s teacher cannot', async () => {
    allowPrivateNetworksForTests()
    const ok = await http().post(`/api/resources/class/${w.classA}`).set(bearer(c.teacher)).send({ url: `${base}/files/timetable.pdf` })
    expect(ok.status).toBe(201)
    expect(ok.body.name).toBe('timetable.pdf')
    expect((await http().post(`/api/resources/class/${w.classA}`).set(bearer(c.teacher2)).send({ url: `${base}/files/timetable.pdf` })).status).toBe(403)
    expect((await http().post(`/api/resources/class/${w.classA}`).set(bearer(c.student)).send({ url: `${base}/files/timetable.pdf` })).status).toBe(403)
  })

  it('books: a link works together with the title, author and description', async () => {
    allowPrivateNetworksForTests()
    const r = await http().post(`/api/books/class/${w.classA}`).set(bearer(c.clerk)).send({ title: 'Maths from Drive', author: 'R. Sharma', description: 'Chapter 1', url: `${base}/files/timetable.pdf` })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ title: 'Maths from Drive', author: 'R. Sharma', name: 'timetable.pdf' })
    expect((await http().post(`/api/books/class/${w.classA}`).set(bearer(c.clerk)).send({ title: 'No link, no file' })).status).toBe(400)
    expect((await http().post(`/api/books/class/${w.classA}`).set(bearer(c.student)).send({ title: 'x', url: `${base}/files/timetable.pdf` })).status).toBe(403)
  })

  it('homework: a teacher can attach from a link; a student cannot, whatever they send', async () => {
    allowPrivateNetworksForTests()
    reset()
    const ok = await http().post(`/api/homework/${assignmentId}/files`).set(bearer(c.teacher)).send({ url: `${base}/files/timetable.pdf` })
    expect(ok.status).toBe(201)
    expect(ok.body.name).toBe('timetable.pdf')
    hits.length = 0
    const no = await http().post(`/api/homework/${assignmentId}/files`).set(bearer(c.student)).send({ url: `${base}/files/timetable.pdf` })
    expect(no.status).toBe(403)
    expect(no.body.message).toMatch(/Students cannot add files from a link/)
    expect(hits).toEqual([])
    // A student can still upload from their own device.
    expect((await http().post(`/api/homework/${assignmentId}/files`).set(bearer(c.student)).attach('file', PDF, 'mine.pdf')).status).toBe(201)
  })
})

describe('the "?" help', () => {
  it('tells everyone signed in which sources work, and whether they may use links', async () => {
    const teacher = (await c.teacher.get('/import/sources')).body
    expect(teacher).toMatchObject({ canUseLinks: true, maxMb: 100, driveConnected: false })
    expect(teacher.sources.map((s: any) => s.id)).toEqual(['gdrive', 'gdoc', 'dropbox', 'onedrive', 'github', 'direct'])
    expect(teacher.notSupported.length).toBeGreaterThan(0)
    expect(teacher.allowed).toMatch(/PDF/)
    expect((await c.student.get('/import/sources')).body.canUseLinks).toBe(false)
    expect((await http().get('/api/import/sources')).status).toBe(401)
  })
})
