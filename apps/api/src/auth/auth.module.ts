import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Post, UnauthorizedException, UseGuards } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.module'
import { publicSchool } from '../platform/platform.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from './guards'

class LoginDto {
  @IsEmail() email: string
  @IsString() password: string
  /** The school's address (its slug), when signing in from that school's own page. */
  @IsOptional() @IsString() @MaxLength(60) school?: string
}
class ChangePasswordDto {
  @IsString() currentPassword: string
  @IsString() @MinLength(8) newPassword: string
}
class RefreshDto {
  @IsString() refreshToken: string
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private async tokens(userId: string) {
    return {
      accessToken: await this.jwt.signAsync({ sub: userId }, { secret: process.env.JWT_SECRET, expiresIn: '15m' }),
      refreshToken: await this.jwt.signAsync({ sub: userId }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' }),
    }
  }

  /**
   * Signs in within one school when the school's address is given, so someone from another school cannot use this page.
   * Without one, the email alone is used, which works while it belongs to a single school. If the same email and password
   * match accounts at more than one school, the person is asked to use their own school's address instead.
   */
  async login(email: string, password: string, schoolSlug?: string) {
    const address = email.trim()
    let schoolId: string | undefined
    if (schoolSlug) {
      const school = await this.prisma.school.findFirst({ where: { slug: schoolSlug.trim().toLowerCase(), isPlatform: false } })
      if (!school || !school.active) throw new UnauthorizedException('Invalid credentials')
      schoolId = school.id
    }
    const candidates = await this.prisma.user.findMany({
      where: { email: { equals: address, mode: 'insensitive' }, ...(schoolId ? { schoolId } : {}) },
      include: { school: { select: { active: true, isPlatform: true } } },
    })
    const matches: string[] = []
    for (const u of candidates) {
      // A suspended school cannot sign in, but the platform's own super admin always can.
      if (u.active && (u.school.active || u.school.isPlatform) && (await bcrypt.compare(password, u.passwordHash))) matches.push(u.id)
    }
    if (matches.length === 0) throw new UnauthorizedException('Invalid credentials')
    if (matches.length > 1) throw new BadRequestException("This email is used at more than one school. Sign in from your own school's address.")
    return this.tokens(matches[0])
  }

  async changePassword(userId: string, current: string, next: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new UnauthorizedException("Current password is incorrect")
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false } })
    return { ok: true }
  }

  async refresh(token: string) {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: process.env.JWT_REFRESH_SECRET })
      return await this.tokens(p.sub)
    } catch {
      throw new UnauthorizedException()
    }
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.school)
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken)
  }

  @Post("change-password")
  @UseGuards(AuthGuard)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword)
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const s = await this.prisma.school.findUnique({ where: { id: user.schoolId } })
    return { ...user, school: s && !s.isPlatform ? publicSchool(s) : null }
  }
}

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, AuthGuard, PermissionGuard],
  controllers: [AuthController],
  exports: [JwtModule, AuthGuard, PermissionGuard],
})
export class AuthModule {}
