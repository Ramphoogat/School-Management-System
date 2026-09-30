import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { Response } from 'express'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { checkUpload, contentHeaders, MAX_FILE_BYTES, type Upload } from '../storage/uploads'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

const MAX_DOCUMENTS = 200

class UploadMeta {
  @IsOptional() @IsString() @MaxLength(120) title?: string
}

/** School-wide documents: forms, circulars, policies. Clerk, principal and admin publish; everyone in the school downloads. */
@Controller('documents')
@UseGuards(AuthGuard, PermissionGuard)
export class DocumentsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.schoolDocument.findMany({ where: { schoolId: user.schoolId }, orderBy: { createdAt: 'desc' }, take: MAX_DOCUMENTS })
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uploadedById))] } }, select: { id: true, name: true } })
    const who = new Map(people.map((p) => [p.id, p.name]))
    return {
      canUpload: can(user, 'documents', 'write'),
      files: rows.map((r) => ({ id: r.id, title: r.title, name: r.name, size: r.size, createdAt: r.createdAt, uploadedBy: who.get(r.uploadedById) ?? '' })),
    }
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @Body() meta: UploadMeta, @UploadedFile() file: Upload | undefined) {
    if (!can(user, 'documents', 'write')) throw new ForbiddenException()
    const checked = checkUpload(file)
    if ((await this.prisma.schoolDocument.count({ where: { schoolId: user.schoolId } })) >= MAX_DOCUMENTS) throw new BadRequestException(`The school already has ${MAX_DOCUMENTS} documents. Remove some first.`)
    const storageKey = newKey()
    await putFile(storageKey, file!.buffer)
    try {
      const title = meta.title?.trim() || checked.name.replace(/\.[^.]+$/, '')
      const row = await this.prisma.schoolDocument.create({ data: { schoolId: user.schoolId, uploadedById: user.id, title, name: checked.name, mime: checked.mime, size: file!.size, storageKey } })
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'document.uploaded', resource: 'document', resourceId: row.id, meta: { title, name: row.name, size: row.size } })
      return { id: row.id, title: row.title, name: row.name, size: row.size, createdAt: row.createdAt, uploadedBy: user.name }
    } catch (e) {
      await deleteFile(storageKey)
      throw e
    }
  }

  @Get(':id/file')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const f = await this.prisma.schoolDocument.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!f) throw new NotFoundException()
    const data = await getFile(f.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('File is missing from storage')
    res.set(contentHeaders(f, data.length))
    res.end(data)
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!can(user, 'documents', 'write')) throw new ForbiddenException()
    const f = await this.prisma.schoolDocument.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!f) throw new NotFoundException()
    await this.prisma.schoolDocument.delete({ where: { id } })
    await deleteFile(f.storageKey)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'document.deleted', resource: 'document', resourceId: id, meta: { title: f.title, name: f.name } })
    return { ok: true }
  }
}

@Module({ controllers: [DocumentsController] })
export class DocumentsModule {}
