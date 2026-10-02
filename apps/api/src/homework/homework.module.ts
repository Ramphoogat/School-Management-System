import { BadRequestException, Body, Controller, ForbiddenException, Get, Delete, Module, NotFoundException, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { can } from '@school/permissions'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { Channel, CHANNELS, EventBus } from '../events/events.module'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { checkUpload, contentHeaders, MAX_FILE_BYTES, type Upload } from '../storage/uploads'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'
import { ImportService } from '../import/import.module'

const MAX_FILES_PER_OWNER = 5
const fileView = (f: { id: string; name: string; size: number; createdAt: Date }) => ({ id: f.id, name: f.name, size: f.size, createdAt: f.createdAt })

class AssignDto {
  /** One class, or several (bulk assign). */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) classIds: string[]
  @IsString() @MinLength(1) title: string
  @IsString() description: string
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate: string
  @IsOptional() @IsArray() @IsIn(CHANNELS, { each: true }) channels?: Channel[]
}
class SubmitDto {
  @IsString() @MinLength(1) text: string
}
class UploadLink {
  /** A link to fetch the file from, instead of uploading one. Teachers only: students always upload from their own device. */
  @IsOptional() @IsString() @MaxLength(2000) url?: string
}

@Controller('homework')
@UseGuards(AuthGuard, PermissionGuard)
export class HomeworkController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bus: EventBus, private importer: ImportService) {}

  /** Who may see a class's homework: its members and teacher, school staff, and parents of a child in it. */
  private async canViewClass(user: AuthUser, classId: string) {
    let allowed = can(user, 'homework', 'read', { classId }) || can(user, 'homework', 'write', { classId }) || can(user, 'homework', 'read')
    if (!allowed && user.role === 'parent') {
      const kids = await this.prisma.classMember.findFirst({ where: { classId, userId: { in: user.linkedStudentIds ?? [] } } })
      allowed = !!kids && can(user, 'homework', 'read', { studentId: kids.userId })
    }
    return allowed
  }

  /** Assignments for a class. Student: own class. Parent: linked child's class. Teacher: own class. Staff: school. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('classId') classId: string) {
    if (!classId) throw new BadRequestException('classId required')
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    let allowed = can(user, 'homework', 'read', { classId }) || can(user, 'homework', 'write', { classId }) || can(user, 'homework', 'read')
    if (!allowed && user.role === 'parent') {
      const kids = await this.prisma.classMember.findFirst({ where: { classId, userId: { in: user.linkedStudentIds ?? [] } } })
      allowed = !!kids && can(user, 'homework', 'read', { studentId: kids.userId })
    }
    if (!allowed) throw new ForbiddenException()
    const rows = await this.prisma.assignment.findMany({
      where: { classId },
      orderBy: { dueDate: 'asc' },
      include: { submissions: { select: { studentId: true, submittedAt: true, text: true } }, files: { orderBy: { createdAt: 'asc' } } },
    })
    const isStudent = user.role === 'student'
    const canReview = can(user, 'homework', 'write', { classId }) || can(user, 'homework', 'read')
    const studentCount = canReview ? await this.prisma.classMember.count({ where: { classId, roleInClass: 'student' } }) : undefined
    return rows.map(({ submissions, files, ...a }) => ({
      ...a,
      files: files.filter((f) => !f.studentId).map(fileView),
      myFiles: isStudent ? files.filter((f) => f.studentId === user.id).map(fileView) : undefined,
      dueDate: a.dueDate.toISOString().slice(0, 10),
      submittedCount: submissions.length,
      studentCount,
      mySubmission: isStudent ? submissions.find((s) => s.studentId === user.id) ?? null : undefined,
      canReview,
    }))
  }

  /** Bulk assign to several classes. Each class is checked independently. */
  @Post()
  async assign(@CurrentUser() user: AuthUser, @Body() dto: AssignDto) {
    const single = dto.classIds.length === 1
    if (!single && !dto.classIds.every((id) => can(user, 'homework', 'bulk_write', { classId: id }))) throw new ForbiddenException()
    const bulkId = randomUUID()
    const results: { classId: string; ok: boolean; error?: string }[] = []
    for (const classId of [...new Set(dto.classIds)]) {
      const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId, deletedAt: null } })
      if (!cls || !can(user, 'homework', 'write', { classId })) {
        results.push({ classId, ok: false, error: 'Not permitted for this class' })
        continue
      }
      const a = await this.prisma.assignment.create({
        data: { schoolId: user.schoolId, classId, title: dto.title, description: dto.description, dueDate: new Date(`${dto.dueDate}T00:00:00.000Z`), createdById: user.id },
      })
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'homework.assigned', resource: 'assignment', resourceId: a.id, bulkId: single ? undefined : bulkId })
      await this.bus.emit('homework.assigned', { schoolId: user.schoolId, classId, assignmentId: a.id, title: a.title, dueDate: dto.dueDate, channels: dto.channels ?? ['email', 'in_app'], actorId: user.id })
      results.push({ classId, ok: true })
    }
    if (!single) {
      await this.prisma.bulkActionLog.create({
        data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'assignment', action: 'assign', recordIds: dto.classIds, resultSummary: { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) } },
      })
    }
    if (single && !results[0].ok) throw new ForbiddenException(results[0].error)
    return { results }
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitDto) {
    const a = await this.prisma.assignment.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!a) throw new NotFoundException()
    const member = await this.prisma.classMember.findFirst({ where: { classId: a.classId, userId: user.id, roleInClass: 'student' } })
    if (!member || !can(user, 'homework', 'submit', { studentId: user.id })) throw new ForbiddenException()
    const s = await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: id, studentId: user.id } },
      update: { text: dto.text, submittedAt: new Date() },
      create: { assignmentId: id, studentId: user.id, text: dto.text },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'homework.submitted', resource: 'assignment', resourceId: id })
    return s
  }

  @Get(':id/submissions')
  async submissions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const a = await this.prisma.assignment.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!a) throw new NotFoundException()
    if (!can(user, 'homework', 'write', { classId: a.classId }) && !can(user, 'homework', 'read')) throw new ForbiddenException()
    const [members, subs, files] = await Promise.all([
      this.prisma.classMember.findMany({ where: { classId: a.classId, roleInClass: 'student' }, include: { user: { select: { id: true, name: true } } } }),
      this.prisma.submission.findMany({ where: { assignmentId: id } }),
      this.prisma.homeworkFile.findMany({ where: { assignmentId: id, studentId: { not: null } }, orderBy: { createdAt: 'asc' } }),
    ])
    const m = new Map(subs.map((s) => [s.studentId, s]))
    return members.map((x) => ({ studentId: x.user.id, name: x.user.name, submittedAt: m.get(x.user.id)?.submittedAt ?? null, text: m.get(x.user.id)?.text ?? null, files: files.filter((f) => f.studentId === x.user.id).map(fileView) }))
  }

  /**
   * Attach a file. A teacher of the class attaches to the assignment; a student of the class hands in against their own
   * submission (created empty if they have not written anything yet).
   */
  @Post(':id/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UploadLink, @UploadedFile() file: Upload | undefined) {
    const a = await this.prisma.assignment.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!a) throw new NotFoundException()
    const teacher = can(user, 'homework', 'write', { classId: a.classId })
    const member = user.role === 'student' && can(user, 'homework', 'submit', { studentId: user.id }) && !!(await this.prisma.classMember.findFirst({ where: { classId: a.classId, userId: user.id, roleInClass: 'student' } }))
    if (!teacher && !member) throw new ForbiddenException()
    // The importer refuses students itself; the link is only for the people who may attach to an assignment.
    const upload = file ?? (body?.url?.trim() ? await this.importer.fromLink(user, body.url) : undefined)
    const checked = checkUpload(upload)
    const studentId = teacher ? null : user.id
    if ((await this.prisma.homeworkFile.count({ where: { assignmentId: id, studentId } })) >= MAX_FILES_PER_OWNER) throw new BadRequestException(`At most ${MAX_FILES_PER_OWNER} files here. Remove one first.`)
    const storageKey = newKey()
    await putFile(storageKey, upload!.buffer, { schoolId: user.schoolId })
    try {
      if (studentId) await this.prisma.submission.upsert({ where: { assignmentId_studentId: { assignmentId: id, studentId } }, update: {}, create: { assignmentId: id, studentId, text: '' } })
      const row = await this.prisma.homeworkFile.create({ data: { schoolId: user.schoolId, assignmentId: id, studentId, uploadedById: user.id, name: checked.name, mime: checked.mime, size: upload!.size, storageKey } })
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'homework.file_uploaded', resource: 'assignment', resourceId: id, meta: { fileId: row.id, name: row.name, size: row.size } })
      return fileView(row)
    } catch (e) {
      await deleteFile(storageKey)
      throw e
    }
  }

  /** Access follows the assignment: the teacher's attachment is visible to anyone who can see the class; a hand-in only to that student, their parents, the class teacher and school staff. */
  private async fileAccess(user: AuthUser, fileId: string) {
    const f = await this.prisma.homeworkFile.findFirst({ where: { id: fileId, schoolId: user.schoolId }, include: { assignment: { select: { classId: true } } } })
    if (!f) throw new NotFoundException()
    const classId = f.assignment.classId
    const teacher = can(user, 'homework', 'write', { classId })
    const staff = teacher || can(user, 'homework', 'read')
    const allowed = !f.studentId
      ? await this.canViewClass(user, classId)
      : staff || user.id === f.studentId || (user.role === 'parent' && (user.linkedStudentIds ?? []).includes(f.studentId) && can(user, 'homework', 'read', { studentId: f.studentId }))
    if (!allowed) throw new ForbiddenException()
    return { f, teacher }
  }

  @Get('files/:fileId')
  async download(@CurrentUser() user: AuthUser, @Param('fileId') fileId: string, @Res() res: Response) {
    const { f } = await this.fileAccess(user, fileId)
    const data = await getFile(f.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('File is missing from storage')
    res.set(contentHeaders(f, data.length))
    res.end(data)
  }

  /** The uploader or the class's teacher can remove a file. */
  @Delete('files/:fileId')
  async remove(@CurrentUser() user: AuthUser, @Param('fileId') fileId: string) {
    const { f, teacher } = await this.fileAccess(user, fileId)
    if (f.uploadedById !== user.id && !teacher) throw new ForbiddenException()
    await this.prisma.homeworkFile.delete({ where: { id: f.id } })
    await deleteFile(f.storageKey)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'homework.file_deleted', resource: 'assignment', resourceId: f.assignmentId, meta: { fileId: f.id, name: f.name } })
    return { ok: true }
  }

}

@Module({ controllers: [HomeworkController] })
export class HomeworkModule {}
