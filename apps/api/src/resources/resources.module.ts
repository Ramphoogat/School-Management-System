import { BadRequestException, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { checkUpload, contentHeaders, MAX_FILE_BYTES, type Upload } from '../storage/uploads'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

const MAX_FILES_PER_CLASS = 100

/** Documents a class's teacher shares in its resources channel (notes, worksheets, syllabus). */
@Controller('resources')
@UseGuards(AuthGuard, PermissionGuard)
export class ResourcesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async loadClass(user: AuthUser, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    return cls
  }

  /** Class members, the class teacher, school staff, and parents of a child in the class. */
  private async canRead(user: AuthUser, classId: string) {
    if (can(user, 'resources', 'write', { classId }) || can(user, 'resources', 'read', { classId }) || can(user, 'resources', 'read')) return true
    if (user.role !== 'parent') return false
    const kid = await this.prisma.classMember.findFirst({ where: { classId, userId: { in: user.linkedStudentIds ?? [] } } })
    return !!kid && can(user, 'resources', 'read', { studentId: kid.userId })
  }

  @Get('class/:classId')
  async list(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    await this.loadClass(user, classId)
    if (!(await this.canRead(user, classId))) throw new ForbiddenException()
    const rows = await this.prisma.resourceFile.findMany({ where: { classId }, orderBy: { createdAt: 'desc' } })
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uploadedById))] } }, select: { id: true, name: true } })
    const who = new Map(people.map((p) => [p.id, p.name]))
    return {
      canUpload: can(user, 'resources', 'write', { classId }),
      files: rows.map((r) => ({ id: r.id, name: r.name, size: r.size, createdAt: r.createdAt, uploadedBy: who.get(r.uploadedById) ?? '' })),
    }
  }

  @Post('class/:classId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @UploadedFile() file: Upload | undefined) {
    await this.loadClass(user, classId)
    if (!can(user, 'resources', 'write', { classId })) throw new ForbiddenException()
    const checked = checkUpload(file)
    if ((await this.prisma.resourceFile.count({ where: { classId } })) >= MAX_FILES_PER_CLASS) throw new BadRequestException(`This class already has ${MAX_FILES_PER_CLASS} files. Remove some first.`)
    const storageKey = newKey()
    await putFile(storageKey, file!.buffer)
    try {
      const row = await this.prisma.resourceFile.create({ data: { schoolId: user.schoolId, classId, uploadedById: user.id, name: checked.name, mime: checked.mime, size: file!.size, storageKey } })
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'resource.uploaded', resource: 'resource', resourceId: row.id, meta: { classId, name: row.name, size: row.size } })
      return { id: row.id, name: row.name, size: row.size, createdAt: row.createdAt, uploadedBy: user.name }
    } catch (e) {
      await deleteFile(storageKey)
      throw e
    }
  }

  private async loadFile(user: AuthUser, id: string) {
    const f = await this.prisma.resourceFile.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!f) throw new NotFoundException()
    return f
  }

  @Get('files/:id')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const f = await this.loadFile(user, id)
    if (!(await this.canRead(user, f.classId))) throw new ForbiddenException()
    const data = await getFile(f.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('File is missing from storage')
    res.set(contentHeaders(f, data.length))
    res.end(data)
  }

  /** The class's teacher removes files. */
  @Delete('files/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const f = await this.loadFile(user, id)
    if (!can(user, 'resources', 'write', { classId: f.classId })) throw new ForbiddenException()
    await this.prisma.resourceFile.delete({ where: { id } })
    await deleteFile(f.storageKey)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'resource.deleted', resource: 'resource', resourceId: id, meta: { classId: f.classId, name: f.name } })
    return { ok: true }
  }
}

@Module({ controllers: [ResourcesController] })
export class ResourcesModule {}
