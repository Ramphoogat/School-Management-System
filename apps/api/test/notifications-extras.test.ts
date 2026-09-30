import { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kindsFor } from '@dist/live/live.module'
import { quietUntil } from '@dist/notifications/quiet-hours'
import { fill, unknownPlaceholders, templateFor } from '@dist/notifications/templates'
import { clients, createApp, daysFromNow, prisma, resetDb, seedWorld, type World } from './helpers'

let app: INestApplication
let w: World, wb: World
let c: Awaited<ReturnType<typeof clients>>, cb: Awaited<ReturnType<typeof clients>>
let port: number
const sockets: Socket[] = []

beforeAll(async () => {
  app = await createApp()
  await resetDb()
  w = await seedWorld('A'); wb = await seedWorld('B')
  c = await clients(app, 'a'); cb = await clients(app, 'b')
  await app.listen(0)
  port = (app.getHttpServer().address() as { port: number }).port
})
afterAll(async () => { sockets.forEach((s) => s.close()); await app.close(); await prisma.$disconnect() })

const rowsFor = (userId: string, event: string, channel?: string) => prisma.notification.findMany({ where: { userId, event, ...(channel ? { channel } : {}) }, orderBy: { createdAt: 'asc' } })
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000)
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
const fee = (title: string, dueDate: string) => c.clerk.post('/fees/invoices', { classId: w.classA, title, amount: 500000, dueDate })

describe('quiet hours: the rule itself', () => {
  const at = (iso: string) => new Date(iso)
  const night = { start: '22:00', end: '07:00', timezone: 'UTC' }

  it('holds messages until the window ends, including one that crosses midnight', () => {
    expect(quietUntil(at('2026-10-01T23:30:00Z'), night)?.toISOString()).toBe('2026-10-02T07:00:00.000Z')
    expect(quietUntil(at('2026-10-02T03:00:00Z'), night)?.toISOString()).toBe('2026-10-02T07:00:00.000Z')
    expect(quietUntil(at('2026-10-02T12:00:00Z'), night)).toBeNull()
    expect(quietUntil(at('2026-10-02T07:00:00Z'), night)).toBeNull() // the window has just ended
    expect(quietUntil(at('2026-10-02T22:00:00Z'), night)?.toISOString()).toBe('2026-10-03T07:00:00.000Z')
  })

  it('uses the person\'s own timezone', () => {
    const ist = { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' } // UTC+5:30
    expect(quietUntil(at('2026-10-01T17:00:00Z'), ist)?.toISOString()).toBe('2026-10-02T01:30:00.000Z') // 22:30 in Kolkata
    expect(quietUntil(at('2026-10-01T09:00:00Z'), ist)).toBeNull() // 14:30 in Kolkata
  })

  it('handles a same-day window, an empty window and a bad timezone', () => {
    const lunch = { start: '13:00', end: '14:00', timezone: 'UTC' }
    expect(quietUntil(at('2026-10-01T13:20:00Z'), lunch)?.toISOString()).toBe('2026-10-01T14:00:00.000Z')
    expect(quietUntil(at('2026-10-01T14:00:00Z'), lunch)).toBeNull()
    expect(quietUntil(at('2026-10-01T13:20:00Z'), { start: '09:00', end: '09:00', timezone: 'UTC' })).toBeNull()
    expect(quietUntil(at('2026-10-01T13:20:00Z'), { start: '13:00', end: '14:00', timezone: 'Not/AZone' })).toBeNull()
  })
})

describe('templates: helpers and live categories', () => {
  it('fills placeholders and blanks unknown ones instead of showing braces', () => {
    expect(fill('{title}, Rs {amount}', { title: 'Term 1', amount: '5000.00' })).toBe('Term 1, Rs 5000.00')
    expect(fill('Hello {nobody}!', {})).toBe('Hello !')
    expect(unknownPlaceholders(templateFor('fee.due')!, '{title} {secret} {when} {oops}')).toEqual(['secret', 'oops'])
  })

  it('maps changes to the screens they touch', () => {
    expect(kindsFor('leave.requested')).toEqual(expect.arrayContaining(['leave', 'todo']))
    expect(kindsFor('fees.waiver_bulk_approve')).toEqual(expect.arrayContaining(['waivers', 'fees']))
    expect(kindsFor('role_request.bulk_approve')).toContain('role_requests')
    expect(kindsFor('results.submitted')).toContain('results')
    expect(kindsFor('message.reported')).toContain('message_reports')
    expect(kindsFor('something.unknown')).toEqual(['todo'])
  })
})

describe('templates: the admin screen', () => {
  it('only the admin can read or change them, and the list shows the wording and placeholders', async () => {
    for (const r of ['student', 'parent', 'teacher', 'clerk', 'principal'] as const) expect((await c[r].get('/notifications/templates')).status, r).toBe(403)
    const list = await c.admin.get('/notifications/templates')
    expect(list.status).toBe(200)
    const ann = list.body.find((t: any) => t.event === 'announcement.posted')
    expect(ann.urgent).toMatchObject({ custom: false, subject: 'Urgent: {title}' })
    expect(ann.normal).toMatchObject({ custom: false, subject: '{title}', body: '{body}' })
    expect(ann.vars.map((v: any) => v.name)).toEqual(['title', 'body'])
    expect(list.body.find((t: any) => t.event === 'fee.due').urgent).toBeNull() // this one has no urgent wording
    expect((await c.principal.put('/notifications/templates/fee.due/normal', { subject: 'x', body: 'y' })).status).toBe(403)
  })

  it('rejects placeholders the event does not offer, empty texts, and templates that do not exist', async () => {
    const bad = await c.admin.put('/notifications/templates/fee.due/normal', { subject: 'Hi {parentName}', body: 'Pay {title}' })
    expect(bad.status).toBe(400)
    expect(bad.body.message).toMatch(/\{parentName\}/)
    expect(bad.body.message).toMatch(/\{title\}/) // and says what is available
    expect((await c.admin.put('/notifications/templates/fee.due/normal', { subject: '', body: 'x' })).status).toBe(400)
    expect((await c.admin.put('/notifications/templates/fee.due/normal', { subject: '   ', body: '   ' })).status).toBe(400)
    expect((await c.admin.put('/notifications/templates/fee.due/urgent', { subject: 'a', body: 'b' })).status).toBe(404) // no urgent wording for this event
    expect((await c.admin.put('/notifications/templates/nope/normal', { subject: 'a', body: 'b' })).status).toBe(404)
    expect((await c.admin.put('/notifications/templates/fee.due/loud', { subject: 'a', body: 'b' })).status).toBe(404)
  })

  it('an edited template is what people receive, only for that school, and reset brings the default back', async () => {
    const save = await c.admin.put('/notifications/templates/fee.due/normal', { subject: 'Fee reminder: {title}', body: 'Please pay Rs {amount} by {dueDate}.' })
    expect(save.status).toBe(200)
    expect((await c.admin.get('/notifications/templates')).body.find((t: any) => t.event === 'fee.due').normal).toMatchObject({ custom: true, subject: 'Fee reminder: {title}', default: { subject: 'Fee due soon' } })
    expect((await cb.admin.get('/notifications/templates')).body.find((t: any) => t.event === 'fee.due').normal.custom).toBe(false) // another school

    await fee('Lab fee', daysFromNow(2))
    expect((await c.clerk.post('/fees/reminders/run')).body.due).toBe(2)
    const got = (await rowsFor(w.u.parent, 'fee.due', 'in_app'))[0]
    expect(got.subject).toBe('Fee reminder: Lab fee')
    expect(got.body).toBe('Please pay Rs 5000.00 by ' + daysFromNow(2) + '.')

    expect((await c.admin.delete('/notifications/templates/fee.due/normal')).status).toBe(200)
    await fee('Sports fee', daysFromNow(2))
    await c.clerk.post('/fees/reminders/run')
    const after = (await rowsFor(w.u.parent, 'fee.due', 'in_app')).find((r) => /Sports fee/.test(r.body))!
    expect(after.subject).toBe('Fee due soon')
    expect((await prisma.auditLog.findMany({ where: { action: { in: ['notification.template_updated', 'notification.template_reset'] } } })).length).toBe(2)
  })
})

describe('urgent versus normal', () => {
  it('an urgent announcement uses the urgent wording, is flagged, and a normal one is not', async () => {
    await c.admin.put('/notifications/templates/announcement.posted/urgent', { subject: 'URGENT NOTICE: {title}', body: '{body} Please read now.' })
    await c.teacher.post('/announcements', { classId: w.classA, title: 'Bus delayed', body: 'The bus is late.', urgent: true, channels: ['in_app', 'email'] })
    await c.teacher.post('/announcements', { classId: w.classA, title: 'Book fair', body: 'Next week.', urgent: false, channels: ['in_app', 'email'] })
    const urgent = (await rowsFor(w.u.student, 'announcement.posted', 'in_app')).find((n) => /Bus delayed/.test(n.subject))!
    expect(urgent).toMatchObject({ subject: 'URGENT NOTICE: Bus delayed', body: 'The bus is late. Please read now.', urgent: true })
    const normal = (await rowsFor(w.u.student, 'announcement.posted', 'in_app')).find((n) => /Book fair/.test(n.subject))!
    expect(normal).toMatchObject({ subject: 'Book fair', body: 'Next week.', urgent: false })
    await c.admin.delete('/notifications/templates/announcement.posted/urgent')
  })

  it('a fee 30 or more days overdue is urgent, a recent one is not, and the in-app list carries the flag', async () => {
    await fee('Old fee', daysFromNow(-40))
    await fee('Recent fee', daysFromNow(-5))
    await c.clerk.post('/fees/reminders/run')
    const all = await rowsFor(w.u.parent, 'fee.overdue', 'in_app')
    const old = all.find((n) => /Old fee/.test(n.body))!
    const recent = all.find((n) => /Recent fee/.test(n.body))!
    expect(old).toMatchObject({ urgent: true, subject: 'Urgent: fee overdue' })
    expect(old.body).toMatch(/now 40 days overdue/)
    expect(recent).toMatchObject({ urgent: false, subject: 'Fee overdue' })
    const mine = (await c.parent.get('/notifications')).body.find((n: any) => n.id === old.id)
    expect(mine.urgent).toBe(true)
  })
})

describe('quiet hours: delivery', () => {
  const setQuiet = (who: keyof typeof c, body: object) => c[who].put('/notifications/quiet-hours', { timezone: 'UTC', ...body })

  it('validates what a person can save, and gives back what they saved', async () => {
    expect((await setQuiet('parent', { enabled: true, start: '25:00', end: '07:00' })).status).toBe(400)
    expect((await setQuiet('parent', { enabled: true, start: '22:00', end: '7am' })).status).toBe(400)
    expect((await c.parent.put('/notifications/quiet-hours', { enabled: true, start: '22:00', end: '07:00', timezone: 'Mars/Base' })).status).toBe(400)
    expect((await setQuiet('parent', { enabled: true, start: '08:00', end: '08:00' })).status).toBe(400)
    expect((await setQuiet('parent', { enabled: true, start: '22:00', end: '07:00' })).status).toBe(200)
    expect((await c.parent.get('/notifications/quiet-hours')).body).toEqual({ enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' })
    expect((await c.student.get('/notifications/quiet-hours')).body).toMatchObject({ enabled: false }) // nobody else is affected
  })

  it('holds email until the window ends, but not the in-app alert, and not when the window is off or elsewhere', async () => {
    const now = new Date()
    const around = { enabled: true, start: hhmm(inMinutes(-60)), end: hhmm(inMinutes(120)) } // it is quiet right now
    expect((await setQuiet('parent', around)).status).toBe(200)
    await fee('Held fee', daysFromNow(2))
    await c.clerk.post('/fees/reminders/run')

    const email = (await rowsFor(w.u.parent, 'fee.due', 'email')).find((n) => /Held fee/.test(n.body))!
    const inApp = (await rowsFor(w.u.parent, 'fee.due', 'in_app')).find((n) => /Held fee/.test(n.body))!
    expect(email.status).toBe('queued')
    expect(email.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime() + 100 * 60_000) // about two hours away
    expect(email.nextAttemptAt.getTime()).toBeLessThan(now.getTime() + 125 * 60_000)
    expect(inApp.status).toBe('delivered')
    // The student has no quiet hours, so theirs goes straight away.
    const student = (await rowsFor(w.u.student, 'fee.due', 'email')).find((n) => /Held fee/.test(n.body))!
    expect(student.nextAttemptAt.getTime()).toBeLessThan(now.getTime() + 60_000)

    // The admin's delivery log shows it as scheduled.
    const log = (await c.admin.get('/notifications/log')).body.find((r: any) => r.id === email.id)
    expect(log.scheduledFor).toBeTruthy()
    expect(log.urgent).toBe(false)

    // Turned off, or a window that is not now: no delay.
    await setQuiet('parent', { ...around, enabled: false })
    await fee('Free fee 1', daysFromNow(2)); await c.clerk.post('/fees/reminders/run')
    expect((await rowsFor(w.u.parent, 'fee.due', 'email')).find((n) => /Free fee 1/.test(n.body))!.nextAttemptAt.getTime()).toBeLessThan(Date.now() + 60_000)
    await setQuiet('parent', { enabled: true, start: hhmm(inMinutes(240)), end: hhmm(inMinutes(360)) })
    await fee('Free fee 2', daysFromNow(2)); await c.clerk.post('/fees/reminders/run')
    expect((await rowsFor(w.u.parent, 'fee.due', 'email')).find((n) => /Free fee 2/.test(n.body))!.nextAttemptAt.getTime()).toBeLessThan(Date.now() + 60_000)
  })

  it('urgent messages ignore quiet hours', async () => {
    await setQuiet('parent', { enabled: true, start: hhmm(inMinutes(-60)), end: hhmm(inMinutes(120)) })
    await fee('Very old fee', daysFromNow(-45))
    await c.clerk.post('/fees/reminders/run')
    const email = (await rowsFor(w.u.parent, 'fee.overdue', 'email')).find((n) => /Very old fee/.test(n.body))!
    expect(email.urgent).toBe(true)
    expect(email.nextAttemptAt.getTime()).toBeLessThan(Date.now() + 60_000)
    // A normal overdue fee in the same run is held.
    await fee('Slightly late', daysFromNow(-3)); await c.clerk.post('/fees/reminders/run')
    const held = (await rowsFor(w.u.parent, 'fee.overdue', 'email')).find((n) => /Slightly late/.test(n.body))!
    expect(held.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000)
  })
})

describe('live updates for queues', () => {
  const connect = (token: string) => new Promise<Socket>((resolve) => { const s = io(`http://localhost:${port}`, { auth: { token }, reconnection: false }); sockets.push(s); s.on('connect', () => resolve(s)) })
  const next = (s: Socket, ms = 2500) => new Promise<any>((r) => { s.once('queue:changed', r); setTimeout(() => r('timeout'), ms) })

  it('tells people in the same school that a queue changed, with only a category, and nobody in another school', async () => {
    const clerk = await connect(c.clerk.token), other = await connect(cb.clerk.token)
    await new Promise((r) => setTimeout(r, 200))
    const gotClerk = next(clerk), gotOther = next(other, 900)
    expect((await c.student.post('/leave', { fromDate: daysFromNow(3), toDate: daysFromNow(4), reason: 'Family function' })).status).toBe(201)
    const msg = await gotClerk
    expect(msg.kinds).toEqual(expect.arrayContaining(['leave', 'todo']))
    expect(Object.keys(msg)).toEqual(['kinds']) // no ids, names or reasons ever go over the wire
    expect(await gotOther).toBe('timeout')
  })

  it('batches a burst of changes into one signal', async () => {
    const principal = await connect(c.principal.token)
    await new Promise((r) => setTimeout(r, 200))
    let count = 0
    principal.on('queue:changed', () => { count++ })
    await Promise.all([1, 2, 3].map((i) => c.student2.post('/leave', { fromDate: daysFromNow(10 + i), toDate: daysFromNow(10 + i), reason: `Reason ${i}` })))
    await new Promise((r) => setTimeout(r, 1200))
    expect(count).toBe(1)
  })

  it('does not accept a connection without a valid login', async () => {
    const bad = io(`http://localhost:${port}`, { auth: { token: 'junk' }, reconnection: false })
    sockets.push(bad)
    let got = false
    bad.on('queue:changed', () => { got = true })
    await c.student.post('/leave', { fromDate: daysFromNow(20), toDate: daysFromNow(20), reason: 'Another' })
    await new Promise((r) => setTimeout(r, 900))
    expect(got).toBe(false)
  })
})
