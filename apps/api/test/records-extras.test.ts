import { INestApplication } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import request from 'supertest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pen } from '@dist/pdf/pdf'
import { getFile } from '@dist/storage/storage'
import { clients, createApp, daysFromNow, makeUser, prisma, resetDb, seedWorld, type Client, type World } from './helpers'

let app: INestApplication
let w: World, wb: World
let c: Awaited<ReturnType<typeof clients>>, cb: Awaited<ReturnType<typeof clients>>
const uploads = mkdtempSync(join(tmpdir(), 'school-uploads-'))
const previousDir = process.env.UPLOAD_DIR

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploads // files written by these tests never touch the real uploads folder
  app = await createApp()
  await resetDb()
  w = await seedWorld('A'); wb = await seedWorld('B')
  c = await clients(app, 'a'); cb = await clients(app, 'b')
})
afterAll(async () => {
  await app.close(); await prisma.$disconnect()
  if (previousDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousDir
  rmSync(uploads, { recursive: true, force: true })
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)])
const bin = (who: Client, url: string) => request(app.getHttpServer()).get(`/api${url}`).set('authorization', `Bearer ${who.token}`).buffer(true).parse((res, cb2) => { const chunks: Buffer[] = []; res.on('data', (d: Buffer) => chunks.push(d)); res.on('end', () => cb2(null, Buffer.concat(chunks))) })
const putPhoto = (who: Client, studentId: string, data: Buffer, name = 'photo.png') => request(app.getHttpServer()).put(`/api/id-cards/photo/${studentId}`).set('authorization', `Bearer ${who.token}`).attach('file', data, name)

describe('announcements: edit and delete', () => {
  let id: string
  const post = async (who: Client, extra: object = {}) => (await who.post('/announcements', { classId: w.classA, title: 'Sports day', body: 'Friday at 9am.', channels: ['in_app'], ...extra })).body.id as string

  it('the author can fix an announcement; it is marked edited, and nobody is sent it again', async () => {
    id = await post(c.teacher)
    const before = await prisma.notification.count({ where: { event: 'announcement.posted' } })
    const r = await c.teacher.put(`/announcements/${id}`, { title: 'Sports day moved', body: 'Friday at 10am.' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ title: 'Sports day moved', body: 'Friday at 10am.' })
    expect(r.body.editedAt).toBeTruthy()
    expect(await prisma.notification.count({ where: { event: 'announcement.posted' } })).toBe(before)
    expect(await prisma.auditLog.count({ where: { action: 'announcement.edited', resourceId: id } })).toBe(1)
    const seen = (await c.student.get(`/announcements?classId=${w.classA}`)).body.find((a: any) => a.id === id)
    expect(seen).toMatchObject({ title: 'Sports day moved', canModify: false })
    expect(seen.editedAt).toBeTruthy()
    expect((await c.teacher.get(`/announcements?classId=${w.classA}`)).body.find((a: any) => a.id === id).canModify).toBe(true)
  })

  it('a change that changes nothing is not recorded as an edit, and empty text is refused', async () => {
    const same = await c.teacher.put(`/announcements/${id}`, { title: 'Sports day moved' })
    expect(same.status).toBe(200)
    expect(await prisma.auditLog.count({ where: { action: 'announcement.edited', resourceId: id } })).toBe(1)
    expect((await c.teacher.put(`/announcements/${id}`, { title: '   ' })).status).toBe(400)
    expect((await c.teacher.put(`/announcements/${id}`, { body: '' })).status).toBe(400)
  })

  it('only the author, the principal and the admin can change it, and never across schools', async () => {
    for (const r of ['student', 'parent', 'clerk', 'teacher2'] as const) {
      expect((await c[r].put(`/announcements/${id}`, { title: 'Hacked' }))?.status, r).toBe(403)
      expect((await c[r].delete(`/announcements/${id}`)).status, r).toBe(403)
    }
    expect((await c.principal.put(`/announcements/${id}`, { urgent: true })).status).toBe(200)
    expect((await c.admin.put(`/announcements/${id}`, { urgent: false })).status).toBe(200)
    expect((await cb.principal.put(`/announcements/${id}`, { title: 'Other school' })).status).toBe(404)
    expect((await cb.admin.delete(`/announcements/${id}`)).status).toBe(404)
  })

  it('a teacher who has left the class can no longer change their own post', async () => {
    const mine = await post(c.teacher, { title: 'Reminder' })
    await prisma.classMember.deleteMany({ where: { classId: w.classA, userId: w.u.teacher } })
    expect((await c.teacher.put(`/announcements/${mine}`, { title: 'Still mine?' })).status).toBe(403)
    expect((await c.principal.put(`/announcements/${mine}`, { title: 'Reminder (updated)' })).status).toBe(200)
    await prisma.classMember.create({ data: { classId: w.classA, userId: w.u.teacher, roleInClass: 'teacher' } })
  })

  it('deleting removes it for everyone and keeps the title in the audit log', async () => {
    const gone = await post(c.teacher, { title: 'Cancelled trip' })
    expect((await c.student.delete(`/announcements/${gone}`)).status).toBe(403)
    expect((await c.teacher.delete(`/announcements/${gone}`)).status).toBe(200)
    expect((await c.student.get(`/announcements?classId=${w.classA}`)).body.some((a: any) => a.id === gone)).toBe(false)
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'announcement.deleted', resourceId: gone } })).meta).toMatchObject({ title: 'Cancelled trip' })
    expect((await c.teacher.delete(`/announcements/${gone}`)).status).toBe(404)
    // The principal can remove someone else's.
    expect((await c.principal.delete(`/announcements/${id}`)).status).toBe(200)
  })
})

describe('exams: delete', () => {
  const makeExam = async (name: string) => (await c.teacher.post('/exams', { classId: w.classA, name, subject: 'Maths', maxMarks: 50, date: daysFromNow(-3) })).body.id as string
  const enterMarks = (id: string) => c.teacher.put(`/exams/${id}/marks`, { marks: [{ studentId: w.u.student, score: 40 }, { studentId: w.u.student2, score: 30 }] })
  const submit = async (id: string) => { await enterMarks(id); return c.teacher.post(`/exams/${id}/submit`) }
  const decide = (id: string, decision: 'approve' | 'reject') => c.principal.post('/exams/bulk-approve', { ids: [id], decision, reason: decision === 'reject' ? 'Recheck the marks' : undefined })

  it('a teacher deletes a draft, its marks go with it, and it is audited', async () => {
    const id = await makeExam('Draft test')
    await enterMarks(id)
    for (const r of ['student', 'parent', 'clerk', 'teacher2', 'admin'] as const) expect((await c[r].delete(`/exams/${id}`)).status, r).toBe(403)
    expect((await cb.principal.delete(`/exams/${id}`)).status).toBe(404)
    const listed = (await c.teacher.get(`/exams?classId=${w.classA}`)).body.find((e: any) => e.id === id)
    expect(listed.canDelete).toBe(true)
    const r = await c.teacher.delete(`/exams/${id}`)
    expect(r.body).toMatchObject({ ok: true, marksRemoved: 2 })
    expect(await prisma.exam.count({ where: { id } })).toBe(0)
    expect(await prisma.mark.count({ where: { examId: id } })).toBe(0)
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'exam.deleted', resourceId: id } })).meta).toMatchObject({ name: 'Draft test', status: 'draft', marks: 2 })
    expect((await c.teacher.delete(`/exams/${id}`)).status).toBe(404)
  })

  it('a rejected exam can be deleted by its teacher too', async () => {
    const id = await makeExam('Rejected test')
    await submit(id); await decide(id, 'reject')
    expect((await c.teacher.delete(`/exams/${id}`)).status).toBe(200)
  })

  it('a submitted exam can only be deleted by the principal, and only with a reason', async () => {
    const id = await makeExam('Submitted test')
    await submit(id)
    expect((await c.teacher.get(`/exams?classId=${w.classA}`)).body.find((e: any) => e.id === id).canDelete).toBe(false)
    const denied = await c.teacher.delete(`/exams/${id}`)
    expect(denied.status).toBe(403)
    expect(denied.body.message).toMatch(/principal/i)
    expect((await c.admin.delete(`/exams/${id}?reason=Duplicate`)).status).toBe(403)
    expect((await c.principal.delete(`/exams/${id}`)).status).toBe(400)
    expect((await c.principal.delete(`/exams/${id}?reason=%20%20`)).status).toBe(400)
    expect(await prisma.exam.count({ where: { id } })).toBe(1)
    expect((await c.principal.delete(`/exams/${id}?reason=Entered%20for%20the%20wrong%20class`)).status).toBe(200)
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'exam.deleted', resourceId: id } })).meta).toMatchObject({ status: 'submitted', reason: 'Entered for the wrong class' })
  })

  it('a published exam disappears from report cards when the principal deletes it', async () => {
    const id = await makeExam('Published test')
    await submit(id); await decide(id, 'approve')
    expect((await c.student.get(`/results/student/${w.u.student}`)).body.results.map((r: any) => r.exam)).toContain('Published test')
    expect((await c.teacher.delete(`/exams/${id}?reason=please`)).status).toBe(403)
    expect((await c.principal.delete(`/exams/${id}?reason=Wrong%20paper`)).status).toBe(200)
    expect((await c.student.get(`/results/student/${w.u.student}`)).body.results.map((r: any) => r.exam)).not.toContain('Published test')
  })
})

describe('PDF certificates and report cards', () => {
  let certId: string
  const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-'

  it('draws each script in a font that has it, and never prints an empty box', () => {
    const pen = new Pen(new PDFDocument())
    const scripts = (t: string) => pen.runs(t, 400).map((r) => [r.script, r.text])
    expect(scripts('Asha Rao')).toEqual([['latin', 'Asha Rao']])
    expect(scripts('Zoë Đorđević').map((r) => r[0])).toContain('ext')
    expect(pen.runs('Asha आशा राव Rao', 400).map((r) => [r.script, r.text])).toEqual([['latin', 'Asha '], ['dev', 'आशा'], ['latin', ' '], ['dev', 'राव'], ['latin', ' Rao']])
    expect(pen.runs('Ab 中 Cd', 400).map((r) => r.text).join('')).toBe('Ab ? Cd') // no font has it, so a question mark
    expect(pen.width('Asha Rao', 12)).toBeGreaterThan(30)
    const lines = pen.wrap('one two three four five six seven', 12, 60)
    expect(lines.length).toBeGreaterThan(1)
    lines.forEach((l) => expect(pen.width(l, 12)).toBeLessThanOrEqual(60 + 0.5))
  })

  it('downloads a certificate as a PDF, for the student, their parent and staff only', async () => {
    const issued = await c.clerk.post('/certificates/bulk-issue', { studentIds: [w.u.student], type: 'bonafide' })
    certId = (await prisma.certificate.findFirstOrThrow({ where: { studentId: w.u.student } })).id
    expect(issued.body.succeeded).toBe(1)
    const json = (await c.student.get(`/certificates/${certId}`)).body
    expect(json).toMatchObject({ title: 'Bonafide certificate', studentName: 'student' })
    expect(json.text).toMatch(/bonafide student of this school/)

    for (const who of ['student', 'parent', 'clerk', 'principal'] as const) {
      const r = await bin(c[who], `/certificates/${certId}/pdf`)
      expect(r.status, who).toBe(200)
      expect(r.headers['content-type']).toBe('application/pdf')
      expect(r.headers['content-disposition']).toMatch(/^attachment; filename="Bonafide-certificate-BON-\d{4}-0001\.pdf"/)
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(isPdf(r.body as Buffer), who).toBe(true)
      expect((r.body as Buffer).length).toBeGreaterThan(3000)
    }
    expect((await bin(c.student2, `/certificates/${certId}/pdf`)).status).toBe(403)
    expect((await bin(cb.principal, `/certificates/${certId}/pdf`)).status).toBe(404)
    expect((await request(app.getHttpServer()).get(`/api/certificates/${certId}/pdf`)).status).toBe(401)
    expect((await bin(c.student, '/certificates/nope/pdf')).status).toBe(404)
  })

  it('handles names in other scripts', async () => {
    const hindi = await makeUser(w.schoolId, 'hindi@a.test', 'student', { name: 'आशा राव' })
    await prisma.classMember.create({ data: { classId: w.classA, userId: hindi.id, roleInClass: 'student' } })
    await c.clerk.post('/certificates/bulk-issue', { studentIds: [hindi.id], type: 'transfer' })
    const cert = await prisma.certificate.findFirstOrThrow({ where: { studentId: hindi.id } })
    const r = await bin(c.clerk, `/certificates/${cert.id}/pdf`)
    expect(r.status).toBe(200)
    expect(isPdf(r.body as Buffer)).toBe(true)
    expect(r.headers['content-disposition']).toMatch(/filename\*=UTF-8''Transfer%20certificate/)
  })

  it('downloads a report card as a PDF with the same access as the screen', async () => {
    const exam = (await c.teacher.post('/exams', { classId: w.classA, name: 'Unit Test 1', subject: 'Maths', maxMarks: 50, date: daysFromNow(-4) })).body.id
    await c.teacher.put(`/exams/${exam}/marks`, { marks: [{ studentId: w.u.student, score: 45 }, { studentId: w.u.student2, score: 20 }] })
    await c.teacher.post(`/exams/${exam}/submit`)
    await c.principal.post('/exams/bulk-approve', { ids: [exam], decision: 'approve' })

    for (const who of ['student', 'parent', 'clerk', 'principal'] as const) {
      const r = await bin(c[who], `/results/student/${w.u.student}/pdf`)
      expect(r.status, who).toBe(200)
      expect(isPdf(r.body as Buffer), who).toBe(true)
      expect(r.headers['content-disposition']).toMatch(/Report-card-student\.pdf/)
    }
    expect((await bin(c.student2, `/results/student/${w.u.student}/pdf`)).status).toBe(403)
    expect((await bin(c.teacher2, `/results/student/${w.u.student}/pdf`)).status).toBe(403)
    expect((await bin(cb.principal, `/results/student/${w.u.student}/pdf`)).status).toBe(403)
    // A student with no published results still gets a valid document.
    const empty = await bin(c.clerk, `/results/student/${wb.u.student}/pdf`)
    expect([403, 404]).toContain(empty.status) // another school's student is out of reach
    await c.principal.delete(`/exams/${exam}?reason=cleanup`)
    const none = await bin(c.student, `/results/student/${w.u.student}/pdf`)
    expect(none.status).toBe(200)
    expect(isPdf(none.body as Buffer)).toBe(true)
  })
})

describe('ID card photos', () => {
  it('the office uploads a photo; it is private and stored outside the database row', async () => {
    const up = await putPhoto(c.clerk, w.u.student, PNG)
    expect(up.status).toBe(200)
    expect(up.body.version).toBeGreaterThan(0)
    const row = await prisma.studentPhoto.findUniqueOrThrow({ where: { studentId: w.u.student } })
    expect(row).toMatchObject({ mime: 'image/png', schoolId: w.schoolId })
    expect((await getFile(row.storageKey)).length).toBe(PNG.length)

    for (const who of ['clerk', 'principal', 'admin', 'student', 'parent'] as const) {
      const r = await bin(c[who], `/id-cards/photo/${w.u.student}`)
      expect(r.status, who).toBe(200)
      expect(r.headers['content-type']).toBe('image/png')
      expect(r.headers['cache-control']).toMatch(/private/)
      expect((r.body as Buffer).length).toBe(PNG.length)
    }
    for (const who of ['student2', 'teacher', 'teacher2'] as const) expect((await bin(c[who], `/id-cards/photo/${w.u.student}`)).status, who).toBe(403)
    expect([403, 404]).toContain((await bin(cb.clerk, `/id-cards/photo/${w.u.student}`)).status)
    expect((await request(app.getHttpServer()).get(`/api/id-cards/photo/${w.u.student}`)).status).toBe(401)
    expect((await bin(c.clerk, `/id-cards/photo/${w.u.student2}`)).status).toBe(404) // none yet
  })

  it('only the office can upload or remove, and only real pictures are accepted', async () => {
    for (const who of ['student', 'parent', 'teacher', 'principal'] as const) expect((await putPhoto(c[who], w.u.student2, PNG)).status, who).toBe(403)
    expect((await putPhoto(c.clerk, w.u.student2, Buffer.from('MZ not a picture'), 'p.jpg')).status).toBe(400)
    expect((await putPhoto(c.clerk, w.u.student2, PNG, 'p.gif')).status).toBe(400)
    expect((await putPhoto(c.clerk, w.u.student2, Buffer.concat([PNG, Buffer.alloc(1100 * 1024)]))).status).toBe(413)
    expect((await putPhoto(c.clerk, w.u.teacher, PNG)).status).toBe(404) // only students have ID card photos
    expect((await putPhoto(c.clerk, wb.u.student, PNG)).status).toBe(404) // another school's student
    expect(await prisma.studentPhoto.count({ where: { studentId: w.u.student2 } })).toBe(0)
    expect((await c.student.delete(`/id-cards/photo/${w.u.student}`)).status).toBe(403)
  })

  it('replacing a photo removes the old file, and the list and the cards say who has one', async () => {
    const first = await prisma.studentPhoto.findUniqueOrThrow({ where: { studentId: w.u.student } })
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 3)])
    expect((await putPhoto(c.clerk, w.u.student, jpg, 'new.jpg')).status).toBe(200)
    const second = await prisma.studentPhoto.findUniqueOrThrow({ where: { studentId: w.u.student } })
    expect(second.storageKey).not.toBe(first.storageKey)
    expect(second.mime).toBe('image/jpeg')
    await expect(getFile(first.storageKey)).rejects.toThrow()

    const list = (await c.clerk.get('/id-cards/photos')).body.photos
    expect(list.map((p: any) => p.studentId)).toEqual([w.u.student])
    expect((await c.teacher.get('/id-cards/photos')).status).toBe(403)

    const cards = (await c.clerk.post('/id-cards/bulk', { studentIds: [w.u.student, w.u.student2] })).body.cards
    expect(cards.find((x: any) => x.studentId === w.u.student)).toMatchObject({ hasPhoto: true })
    expect(cards.find((x: any) => x.studentId === w.u.student2)).toMatchObject({ hasPhoto: false, photoVersion: null })
  })

  it('removing a photo deletes the file and is audited', async () => {
    const row = await prisma.studentPhoto.findUniqueOrThrow({ where: { studentId: w.u.student } })
    expect((await c.clerk.delete(`/id-cards/photo/${w.u.student}`)).status).toBe(200)
    expect(await prisma.studentPhoto.count({ where: { studentId: w.u.student } })).toBe(0)
    await expect(getFile(row.storageKey)).rejects.toThrow()
    expect((await bin(c.clerk, `/id-cards/photo/${w.u.student}`)).status).toBe(404)
    expect((await c.clerk.delete(`/id-cards/photo/${w.u.student}`)).status).toBe(200) // removing nothing is fine
    expect(await prisma.auditLog.count({ where: { action: { in: ['idcard.photo_uploaded', 'idcard.photo_removed'] } } })).toBe(3)
  })
})
