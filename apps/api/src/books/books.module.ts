import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { can } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { deleteFile, getFile, newKey, putFile } from '../storage/storage'
import { checkUpload, contentHeaders, MAX_FILE_BYTES, type Upload } from '../storage/uploads'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'
import { ImportService } from '../import/import.module'

const MAX_BOOKS_PER_CLASS = 100

class BookFields {
  @IsString() @MaxLength(120) title: string
  @IsOptional() @IsString() @MaxLength(80) author?: string
  @IsOptional() @IsString() @MaxLength(600) description?: string
  /** A link to fetch the book from, instead of uploading a file (Google Drive, Dropbox, OneDrive, a direct link). */
  @IsOptional() @IsString() @MaxLength(2000) url?: string
}
class RevokeDto {
  @IsString() studentId: string
  @IsOptional() @IsString() @MaxLength(300) reason?: string
}
class RestoreDto {
  @IsString() studentId: string
}

/**
 * The books channel of a class. The class's teacher, the clerk, the principal and the admin add books; the class's students
 * read them. The principal or admin can withdraw one book from one student, and give it back.
 * Parents do not use this channel (a book is for the student it was given to).
 */
@Controller('books')
@UseGuards(AuthGuard, PermissionGuard)
export class BooksController {
  constructor(private prisma: PrismaService, private audit: AuditService, private importer: ImportService) {}

  private async loadClass(user: AuthUser, classId: string) {
    const cls = await this.prisma.class.findFirst({ where: { id: classId, schoolId: user.schoolId } })
    if (!cls) throw new ForbiddenException()
    return cls
  }

  private canAdd(user: AuthUser, classId: string) { return can(user, 'books', 'write', { classId }) }
  private canRevoke(user: AuthUser) { return can(user, 'books', 'revoke') }
  /** Anyone who may add books may also see them; students see their own class's. */
  private canSee(user: AuthUser, classId: string) { return this.canAdd(user, classId) || can(user, 'books', 'read', { classId }) }

  private async loadBook(user: AuthUser, id: string) {
    const b = await this.prisma.book.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!b) throw new NotFoundException()
    return b
  }

  @Get('class/:classId')
  async list(@CurrentUser() user: AuthUser, @Param('classId') classId: string) {
    await this.loadClass(user, classId)
    if (!this.canSee(user, classId)) throw new ForbiddenException()
    const rows = await this.prisma.book.findMany({ where: { classId }, orderBy: { createdAt: 'desc' }, include: { revocations: { select: { studentId: true } } } })
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.addedById))] } }, select: { id: true, name: true } })
    const who = new Map(people.map((p) => [p.id, p.name]))
    const canRevoke = this.canRevoke(user)
    return {
      canAdd: this.canAdd(user, classId),
      canRevoke,
      max: MAX_BOOKS_PER_CLASS,
      books: rows.map((b) => ({
        id: b.id, title: b.title, author: b.author, description: b.description, name: b.name, mime: b.mime, size: b.size, createdAt: b.createdAt,
        addedBy: who.get(b.addedById) ?? '',
        // A student whose use of this book was withdrawn still sees it, so they know why they cannot open it.
        revoked: user.role === 'student' ? b.revocations.some((r) => r.studentId === user.id) : undefined,
        // Only the people who can change it are told how many students lost it.
        revokedCount: canRevoke ? b.revocations.length : undefined,
      })),
    }
  }

  /** Multipart: the text fields (title, author, description) come before the file. */
  @Post('class/:classId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async add(@CurrentUser() user: AuthUser, @Param('classId') classId: string, @Body() body: BookFields, @UploadedFile() file: Upload | undefined) {
    await this.loadClass(user, classId)
    if (!this.canAdd(user, classId)) throw new ForbiddenException()
    const title = (body.title ?? '').trim().replace(/\s+/g, ' ')
    if (!title) throw new BadRequestException('Give the book a title')
    const upload = file ?? (body.url?.trim() ? await this.importer.fromLink(user, body.url) : undefined)
    const checked = checkUpload(upload)
    if ((await this.prisma.book.count({ where: { classId } })) >= MAX_BOOKS_PER_CLASS) throw new BadRequestException(`This class already has ${MAX_BOOKS_PER_CLASS} books. Remove some first.`)
    const storageKey = newKey()
    await putFile(storageKey, upload!.buffer, { schoolId: user.schoolId })
    try {
      const b = await this.prisma.book.create({
        data: { schoolId: user.schoolId, classId, title, author: body.author?.trim() || null, description: body.description?.trim() || null, name: checked.name, mime: checked.mime, size: upload!.size, storageKey, addedById: user.id },
      })
      await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'book.added', resource: 'book', resourceId: b.id, meta: { classId, title, size: b.size } })
      return { id: b.id, title: b.title, author: b.author, description: b.description, name: b.name, mime: b.mime, size: b.size, createdAt: b.createdAt, addedBy: user.name }
    } catch (e) {
      await deleteFile(storageKey)
      throw e
    }
  }

  /** Always an attachment (the browser app opens it from the downloaded copy). A student whose use was withdrawn is refused. */
  @Get('files/:id')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const b = await this.loadBook(user, id)
    if (!this.canSee(user, b.classId)) throw new ForbiddenException()
    if (user.role === 'student' && (await this.prisma.bookRevocation.findUnique({ where: { bookId_studentId: { bookId: id, studentId: user.id } } }))) {
      throw new ForbiddenException('Your use of this book has been withdrawn by the school.')
    }
    const data = await getFile(b.storageKey).catch(() => null)
    if (!data) throw new NotFoundException('The book file is missing from storage')
    res.set(contentHeaders(b, data.length))
    res.end(data)
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const b = await this.loadBook(user, id)
    if (!this.canAdd(user, b.classId)) throw new ForbiddenException()
    await this.prisma.book.delete({ where: { id } }) // withdrawals go with it
    await deleteFile(b.storageKey)
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'book.removed', resource: 'book', resourceId: id, meta: { classId: b.classId, title: b.title } })
    return { ok: true }
  }

  /** The class's students, and which of them can no longer use this book. Principal and admin only. */
  @Get(':id/access')
  async access(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const b = await this.loadBook(user, id)
    if (!this.canRevoke(user)) throw new ForbiddenException()
    const [members, revoked] = await Promise.all([
      this.prisma.classMember.findMany({ where: { classId: b.classId, roleInClass: 'student' }, include: { user: { select: { id: true, name: true, active: true } } } }),
      this.prisma.bookRevocation.findMany({ where: { bookId: id } }),
    ])
    const by = new Map(revoked.map((r) => [r.studentId, r]))
    return {
      book: { id: b.id, title: b.title },
      students: members
        .map((m) => ({ id: m.user.id, name: m.user.name, revoked: by.has(m.user.id), reason: by.get(m.user.id)?.reason ?? null, since: by.get(m.user.id)?.createdAt ?? null }))
        .sort((a, c) => a.name.localeCompare(c.name)),
    }
  }

  @Post(':id/revoke')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RevokeDto) {
    const b = await this.loadBook(user, id)
    if (!this.canRevoke(user)) throw new ForbiddenException()
    const member = await this.prisma.classMember.findFirst({ where: { classId: b.classId, userId: dto.studentId, roleInClass: 'student' } })
    if (!member) throw new BadRequestException('That student is not in this class')
    const reason = dto.reason?.trim() || null
    await this.prisma.bookRevocation.upsert({
      where: { bookId_studentId: { bookId: id, studentId: dto.studentId } },
      update: { reason, revokedById: user.id },
      create: { schoolId: user.schoolId, bookId: id, studentId: dto.studentId, revokedById: user.id, reason },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'book.access_revoked', resource: 'book', resourceId: id, meta: { classId: b.classId, studentId: dto.studentId, title: b.title, reason } })
    return { ok: true }
  }

  @Post(':id/restore')
  async restore(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RestoreDto) {
    const b = await this.loadBook(user, id)
    if (!this.canRevoke(user)) throw new ForbiddenException()
    const gone = await this.prisma.bookRevocation.deleteMany({ where: { bookId: id, studentId: dto.studentId } })
    if (gone.count) await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'book.access_restored', resource: 'book', resourceId: id, meta: { classId: b.classId, studentId: dto.studentId, title: b.title } })
    return { ok: true }
  }
}

@Module({ controllers: [BooksController] })
export class BooksModule {}
