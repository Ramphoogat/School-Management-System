import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { roleCan, type Actor } from '@school/permissions'
import { PrismaService } from '../prisma/prisma.module'

export type AuthUser = Actor & { email: string; name: string; mustChangePassword?: boolean }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest()
    const header: string | undefined = req.headers.authorization
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException()
    req.user = await this.authenticate(header.slice(7))
    return true
  }

  /** Verify a JWT and load the user with fresh role and scope. Also used by the chat gateway. */
  async authenticate(token: string): Promise<AuthUser> {
    let payload: { sub: string }
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET })
    } catch {
      throw new UnauthorizedException()
    }
    // Load role and scope from the DB on every request so revocations apply immediately.
    const u = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: { select: { classId: true } },
        asParent: { where: { status: 'approved' }, select: { studentId: true } },
        school: { select: { active: true, isPlatform: true } },
      },
    })
    if (!u || !u.active) throw new UnauthorizedException()
    // A suspended school is locked out straight away, including anyone already signed in.
    if (!u.school.active && !u.school.isPlatform) throw new UnauthorizedException()
    const user: AuthUser = {
      id: u.id,
      role: u.role,
      schoolId: u.schoolId,
      email: u.email,
      name: u.name,
      mustChangePassword: u.mustChangePassword,
      classIds: u.memberships.map((m) => m.classId),
      linkedStudentIds: u.asParent.map((l) => l.studentId),
    }
    return user
  }
}

export const REQUIRE = 'require_permission'
export const RequirePermission = (resource: string, action: string) => SetMetadata(REQUIRE, [resource, action])

/** Coarse route-level check; per-item scope checks happen in services with can(). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const req = this.reflector.get<[string, string] | undefined>(REQUIRE, ctx.getHandler())
    if (!req) return true
    const user: AuthUser = ctx.switchToHttp().getRequest().user
    if (!roleCan(user.role, req[0], req[1])) throw new ForbiddenException()
    return true
  }
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser)
