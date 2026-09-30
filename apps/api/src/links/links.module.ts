import { BadRequestException, ForbiddenException, Body, Controller, Get, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { IsString } from 'class-validator'
import { roleCan } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'
import { AuditService } from '../audit/audit.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

class ProposeLinkDto {
  @IsString() parentId: string
  @IsString() studentId: string
  @IsString() relationship: string
}

@Controller('links')
@UseGuards(AuthGuard, PermissionGuard)
export class LinksController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    if (!roleCan(user.role, "admissions", "write") && !roleCan(user.role, "admissions", "approve")) throw new ForbiddenException();
    return this.prisma.parentStudentLink.findMany({
      where: { schoolId: user.schoolId },
      include: { parent: { select: { name: true } }, student: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  @Post()
  @RequirePermission('admissions', 'write')
  async propose(@CurrentUser() user: AuthUser, @Body() dto: ProposeLinkDto) {
    const [parent, student] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: dto.parentId, schoolId: user.schoolId, role: 'parent' } }),
      this.prisma.user.findFirst({ where: { id: dto.studentId, schoolId: user.schoolId, role: 'student' } }),
    ])
    if (!parent || !student) throw new BadRequestException('Parent or student not found in this school')
    const link = await this.prisma.parentStudentLink.create({
      data: { schoolId: user.schoolId, parentId: parent.id, studentId: student.id, relationship: dto.relationship, proposedById: user.id },
    })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'link.proposed', resource: 'parent_link', resourceId: link.id })
    return link
  }

  @Post(':id/approve')
  @RequirePermission('admissions', 'approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const link = await this.prisma.parentStudentLink.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!link) throw new NotFoundException()
    const upd = await this.prisma.parentStudentLink.update({ where: { id }, data: { status: 'approved', approvedById: user.id } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'link.approved', resource: 'parent_link', resourceId: id })
    return upd
  }

  @Post(':id/revoke')
  @RequirePermission('admissions', 'approve')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const link = await this.prisma.parentStudentLink.findFirst({ where: { id, schoolId: user.schoolId } })
    if (!link) throw new NotFoundException()
    const upd = await this.prisma.parentStudentLink.update({ where: { id }, data: { status: 'revoked' } })
    await this.audit.log(this.prisma, { schoolId: user.schoolId, actorId: user.id, action: 'link.revoked', resource: 'parent_link', resourceId: id })
    return upd
  }
}

@Module({ controllers: [LinksController] })
export class LinksModule {}
