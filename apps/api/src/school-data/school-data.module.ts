import { Controller, ForbiddenException, Get, Global, HttpException, HttpStatus, Injectable, Logger, Module, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { Prisma } from '@school/db'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'
import { deleteFile } from '../storage/storage'

/**
 * Everything a school owns, worked out from the database model itself:
 *  - a table with a schoolId column belongs to the school directly;
 *  - the tables below have no schoolId and belong to it through a parent row.
 * A new table has to be one or the other, or the test in school-data.test.ts fails. That is what stops a school's data from
 * being left behind by a delete, or missing from an export, without anyone noticing.
 */
export const CHILD_TABLES: Record<string, { parent: string; fk: string }> = {
  ClassMember: { parent: 'Class', fk: 'classId' },
  Channel: { parent: 'Class', fk: 'classId' },
  Submission: { parent: 'Assignment', fk: 'assignmentId' },
  Mark: { parent: 'Exam', fk: 'examId' },
  Payment: { parent: 'Invoice', fk: 'invoiceId' },
  VoiceNote: { parent: 'VoiceChannel', fk: 'channelId' },
  DirectMessage: { parent: 'Conversation', fk: 'conversationId' },
  ConversationRead: { parent: 'Conversation', fk: 'conversationId' },
  NotificationPreference: { parent: 'User', fk: 'userId' },
  QuietHours: { parent: 'User', fk: 'userId' },
  WhatsAppConsent: { parent: 'User', fk: 'userId' },
}
/** Tables that belong to the platform, not to one school's records. SchoolPayment goes with the school (cascade). */
const NOT_SCHOOL_DATA = new Set(['School', 'Plan', 'SchoolPayment'])

/** Private conversations stay private: they are not part of an export, even the school admin's. */
const EXPORT_EXCLUDED = new Set(['Conversation', 'DirectMessage', 'DmAttachment', 'ConversationRead', 'MessageBlock', 'MessageReport', 'Notification'])
/** Fields that are never exported: secrets and internal storage names. */
const EXPORT_HIDDEN_FIELDS = new Set(['passwordHash', 'storageKey', 'logoKey'])
/** Deleted last, in this order, because other tables point at them. */
const DELETE_LAST = ['ParentStudentLink', 'Class', 'User']

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function classifyModels() {
  const models = Prisma.dmmf.datamodel.models
  const owned: string[] = []
  const children: string[] = []
  const platform: string[] = []
  const unknown: string[] = []
  for (const m of models) {
    if (NOT_SCHOOL_DATA.has(m.name)) platform.push(m.name)
    else if (m.fields.some((f) => f.name === 'schoolId')) owned.push(m.name)
    else if (CHILD_TABLES[m.name]) children.push(m.name)
    else unknown.push(m.name)
  }
  return { owned, children, platform, unknown }
}

@Injectable()
export class SchoolDataService {
  private log = new Logger('SchoolData')
  constructor(private prisma: PrismaService) {}

  private delegate(model: string) {
    return (this.prisma as unknown as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]>; deleteMany: (a: object) => Promise<{ count: number }> }>)[lowerFirst(model)]
  }

  /** The ids of each parent table's rows, for reaching the child tables. */
  private async parentIds(schoolId: string, parents: string[]) {
    const out: Record<string, string[]> = {}
    for (const p of parents) out[p] = (await this.delegate(p).findMany({ where: { schoolId }, select: { id: true } })).map((r) => r.id as string)
    return out
  }

  /** Every record the school owns, as plain data. Private messages, passwords and storage names are left out. */
  async export(schoolId: string) {
    const { owned, children } = classifyModels()
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { plan: true } })
    const strip = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !EXPORT_HIDDEN_FIELDS.has(k))))
    const tables: Record<string, Record<string, unknown>[]> = {}
    const ids = await this.parentIds(schoolId, [...new Set(Object.values(CHILD_TABLES).map((c) => c.parent))])
    for (const m of owned) if (!EXPORT_EXCLUDED.has(m)) tables[m] = strip(await this.delegate(m).findMany({ where: { schoolId } }))
    for (const m of children) {
      if (EXPORT_EXCLUDED.has(m)) continue
      const c = CHILD_TABLES[m]
      tables[m] = strip(await this.delegate(m).findMany({ where: { [c.fk]: { in: ids[c.parent] } } }))
    }
    return {
      exportedAt: new Date().toISOString(),
      note: 'All records the school owns. Private direct messages, notifications, passwords and stored files are not included. Files can be downloaded from their own pages.',
      school: { name: school.name, slug: school.slug, tagline: school.tagline, createdAt: school.createdAt, plan: school.plan?.name ?? null, planEndsOn: school.planEndsOn },
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      tables,
    }
  }

  /** Permanently removes a school and everything it owns, and then the files it stored. Returns how many rows went from each table. */
  async purge(schoolId: string) {
    const { owned, children } = classifyModels()
    const keys: string[] = []
    // Stored files: any table with a storageKey, and the logo.
    for (const m of Prisma.dmmf.datamodel.models) {
      if (NOT_SCHOOL_DATA.has(m.name) || !m.fields.some((f) => f.name === 'storageKey') || !m.fields.some((f) => f.name === 'schoolId')) continue
      for (const r of await this.delegate(m.name).findMany({ where: { schoolId }, select: { storageKey: true } })) if (r.storageKey) keys.push(String(r.storageKey))
    }
    const logo = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { logoKey: true } })
    if (logo?.logoKey) keys.push(logo.logoKey)

    const ids = await this.parentIds(schoolId, [...new Set(Object.values(CHILD_TABLES).map((c) => c.parent))])
    const counts: Record<string, number> = {}
    await this.prisma.$transaction(async (tx) => {
      const del = (model: string) => (tx as unknown as Record<string, { deleteMany: (a: object) => Promise<{ count: number }> }>)[lowerFirst(model)]
      for (const m of children) {
        const c = CHILD_TABLES[m]
        counts[m] = (await del(m).deleteMany({ where: { [c.fk]: { in: ids[c.parent] } } })).count
      }
      for (const m of owned.filter((x) => !DELETE_LAST.includes(x))) counts[m] = (await del(m).deleteMany({ where: { schoolId } })).count
      for (const m of DELETE_LAST) counts[m] = (await del(m).deleteMany({ where: { schoolId } })).count
      await tx.school.delete({ where: { id: schoolId } }) // its payments go with it
    }, { timeout: 120_000, maxWait: 20_000 })

    // The database is the record of truth; a file that cannot be removed is logged, not a reason to undo the delete.
    for (const k of keys) await deleteFile(k).catch((e) => this.log.warn(`Could not remove stored file ${k}: ${(e as Error).message}`))
    return { counts, files: keys.length }
  }
}

const lastExport = new Map<string, number>()
const EXPORT_EVERY_MS = 5 * 60_000

/** A school's own export of its data. The school admin only, and at most once every five minutes. */
@Controller('school')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolExportController {
  constructor(private data: SchoolDataService, private audit: AuditService, private prisma: PrismaService) {}

  @Get('export')
  @RequirePermission('school', 'export')
  async export(@CurrentUser() user: AuthUser, @Res() res: Response) {
    if (!user.schoolId) throw new ForbiddenException()
    const wait = (lastExport.get(user.schoolId) ?? 0) + EXPORT_EVERY_MS - Date.now()
    if (wait > 0) throw new HttpException(`An export was made a moment ago. Try again in ${Math.ceil(wait / 60_000)} minute(s).`, HttpStatus.TOO_MANY_REQUESTS)
    lastExport.set(user.schoolId, Date.now())
    const data = await this.data.export(user.schoolId)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'school.exported', resource: 'school', resourceId: user.schoolId, meta: { counts: data.counts } })
    const body = Buffer.from(JSON.stringify(data, null, 2))
    const slug = data.school.slug ?? 'school'
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(body.length),
      'Content-Disposition': `attachment; filename="${slug}-export-${data.exportedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'private, no-store',
    })
    res.end(body)
  }
}

@Global()
@Module({ providers: [SchoolDataService], controllers: [SchoolExportController], exports: [SchoolDataService] })
export class SchoolDataModule {}
