import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Put, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { roleCan } from '@school/permissions'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { judgeUpload, type Upload } from '../storage/upload-rules'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

class BulkIdCardsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @IsString({ each: true }) studentIds: string[]
}

/** Photos are cropped and shrunk in the browser, so a real one is well under this. */
const MAX_PHOTO_BYTES = 1024 * 1024

/** Stable card number: the same student always gets the same number, so a reprint matches the original. */
export const cardNumber = (studentId: string, joinedAt: Date) => `ID-${joinedAt.getUTCFullYear()}-${studentId.slice(-6).toUpperCase()}`

@Controller('id-cards')
@UseGuards(AuthGuard, PermissionGuard)
export class IdCardsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Card data for many students at once (the page lays them out for printing). Students outside the school are reported, not dropped silently. */
  @Post('bulk')
  @RequirePermission('idcards', 'bulk_write')
  async bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkIdCardsDto) {
    const ids = [...new Set(dto.studentIds)]
    const bulkId = randomUUID()
    const [school, students] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: user.schoolId }, select: { name: true } }),
      this.prisma.user.findMany({
        where: { id: { in: ids }, schoolId: user.schoolId, role: 'student' },
        select: {
          id: true, name: true, createdAt: true,
          memberships: { select: { class: { select: { name: true } } } },
          asStudent: { where: { status: 'approved' }, select: { parent: { select: { name: true, phone: true } } } },
        },
      }),
    ])
    const found = new Map(students.map((s) => [s.id, s]))
    const photos = new Map((await this.prisma.studentPhoto.findMany({ where: { studentId: { in: ids }, schoolId: user.schoolId }, select: { studentId: true, updatedAt: true } })).map((p) => [p.studentId, p.updatedAt.getTime()]))
    const cards = ids.filter((id) => found.has(id)).map((id) => {
      const s = found.get(id)!
      const parent = s.asStudent[0]?.parent
      return { studentId: s.id, name: s.name, className: s.memberships.map((m) => m.class.name).join(', '), number: cardNumber(s.id, s.createdAt), guardian: parent?.name ?? null, guardianPhone: parent?.phone ?? null, hasPhoto: photos.has(id), photoVersion: photos.get(id) ?? null }
    })
    const failed = ids.filter((id) => !found.has(id)).map((studentId) => ({ studentId, error: 'Student not found in this school' }))
    const summary = { total: ids.length, succeeded: cards.length, failed }
    await this.prisma.bulkActionLog.create({ data: { id: bulkId, schoolId: user.schoolId, actorId: user.id, resource: 'idcard', action: 'generate', recordIds: ids, resultSummary: summary as any } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'idcards.bulk_generate', resource: 'idcard', bulkId, meta: { count: ids.length, succeeded: cards.length } })
    return { bulkId, schoolName: school?.name ?? '', cards, ...summary }
  }
}

/** Students' photos for their ID cards. Private: only the office, the school's leaders, the student and their parents can see one. */
@Controller('id-cards')
@UseGuards(AuthGuard, PermissionGuard)
export class IdCardPhotosController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async studentOf(user: AuthUser, id: string) {
    const st = await this.prisma.user.findFirst({ where: { id, schoolId: user.schoolId, role: 'student' }, select: { id: true } })
    if (!st) throw new NotFoundException('Student not found')
    return st
  }

  /** Which students have a photo (and a version to bust caches when it changes). */
  @Get('photos')
  @RequirePermission('idcards', 'bulk_write')
  async which(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.studentPhoto.findMany({ where: { schoolId: user.schoolId }, select: { studentId: true, updatedAt: true } })
    return { photos: rows.map((r) => ({ studentId: r.studentId, version: r.updatedAt.getTime() })) }
  }

  @Put('photo/:studentId')
  @RequirePermission('idcards', 'bulk_write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @UploadedFile() file: Upload | undefined) {
    await this.studentOf(user, studentId)
    if (!file) throw new BadRequestException('Choose a photo (JPG or PNG, up to 1 MB)')
    const type = judgeUpload(file)
    const ext = file.originalname.split('.').pop()?.toLowerCase()
    if (!type || !['png', 'jpg', 'jpeg'].includes(ext ?? '')) throw new BadRequestException('The photo must be a JPG or PNG picture')
    const key = newKey()
    await putFile(key, file.buffer)
    try {
      const old = await this.prisma.studentPhoto.findUnique({ where: { studentId } })
      const row = await this.prisma.studentPhoto.upsert({
        where: { studentId },
        update: { storageKey: key, mime: type.mime, size: file.size, updatedById: user.id },
        create: { studentId, schoolId: user.schoolId, storageKey: key, mime: type.mime, size: file.size, updatedById: user.id },
      })
      if (old) await deleteFile(old.storageKey)
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'idcard.photo_uploaded', resource: 'student', resourceId: studentId, meta: { size: file.size } })
      return { studentId, version: row.updatedAt.getTime() }
    } catch (e) {
      await deleteFile(key)
      throw e
    }
  }

  @Get('photo/:studentId')
  async photo(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string, @Res() res: Response) {
    const allowed = roleCan(user.role, 'idcards', 'bulk_write') || user.role === 'principal' || user.role === 'admin' || user.id === studentId || (user.linkedStudentIds ?? []).includes(studentId)
    if (!allowed) throw new ForbiddenException()
    const p = await this.prisma.studentPhoto.findFirst({ where: { studentId, schoolId: user.schoolId } })
    if (!p) throw new NotFoundException('No photo')
    const data = await getFile(p.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('No photo')
    res.set({ 'Content-Type': p.mime, 'Content-Length': String(data.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' })
    res.end(data)
  }

  @Delete('photo/:studentId')
  @RequirePermission('idcards', 'bulk_write')
  async remove(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    await this.studentOf(user, studentId)
    const p = await this.prisma.studentPhoto.findUnique({ where: { studentId } })
    if (p) {
      await this.prisma.studentPhoto.delete({ where: { studentId } })
      await deleteFile(p.storageKey)
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'idcard.photo_removed', resource: 'student', resourceId: studentId })
    }
    return { ok: true }
  }
}

@Module({ controllers: [IdCardsController, IdCardPhotosController] })
export class IdCardsModule {}
