import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.module'
import { publicSchool } from '../platform/platform.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from './guards'
import { PasswordResetService } from './password-reset'
import { FailureLimiter, LOGIN_MAX_PER_EMAIL, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS, PASSWORD_MAX } from './rate-limit'

// A real hash to compare against when the email is unknown, so that answer takes as long as a wrong password does.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

class LoginDto {
  @IsEmail() @MaxLength(254) email: string
  @IsString() @MaxLength(200) password: string
  /** The school's address (its slug), when signing in from that school's own page. */
  @IsOptional() @IsString() @MaxLength(60) school?: string
}
class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword: string
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string
}
class ForgotDto {
  @IsEmail() @MaxLength(254) email: string
  @IsOptional() @IsString() @MaxLength(60) school?: string
}
class ResetDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string
}
class RefreshDto {
  @IsString() @MaxLength(2000) refreshToken: string
}

@Injectable()
export class AuthService {
  private byEmail = new FailureLimiter(LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_MS)
  private byIp = new FailureLimiter(LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS)
  private byPassword = new FailureLimiter(PASSWORD_MAX, LOGIN_WINDOW_MS)

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private async tokens(userId: string, tv: number) {
    return {
      accessToken: await this.jwt.signAsync({ sub: userId, tv }, { secret: process.env.JWT_SECRET, expiresIn: '15m' }),
      refreshToken: await this.jwt.signAsync({ sub: userId, tv }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' }),
    }
  }

  /**
   * Signs in within one school when the school's address is given, so someone from another school cannot use this page.
   * Without one, the email alone is used, which works while it belongs to a single school. If the same email and password
   * match accounts at more than one school, the person is asked to use their own school's address instead.
   */
  async login(email: string, password: string, schoolSlug?: string, ip = 'unknown') {
    const address = email.trim()
    const emailKey = address.toLowerCase(), ipKey = ip
    this.byEmail.check(emailKey, 'sign-in attempts for this account')
    this.byIp.check(ipKey, 'sign-in attempts from this network')
    try { return await this.attempt(address, password, schoolSlug) } catch (e) {
      if (e instanceof UnauthorizedException) { this.byEmail.fail(emailKey); this.byIp.fail(ipKey) }
      throw e
    }
  }

  private async attempt(address: string, password: string, schoolSlug?: string) {
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
    if (candidates.length === 0) await bcrypt.compare(password, DUMMY_HASH) // same time as a wrong password: no way to tell which emails exist
    if (matches.length === 0) throw new UnauthorizedException('Invalid credentials')
    if (matches.length > 1) throw new BadRequestException("This email is used at more than one school. Sign in from your own school's address.")
    this.byEmail.clear(address.toLowerCase())
    const who = await this.prisma.user.findUniqueOrThrow({ where: { id: matches[0] }, select: { tokenVersion: true } })
    return this.tokens(matches[0], who.tokenVersion)
  }

  async changePassword(userId: string, current: string, next: string) {
    this.byPassword.check(userId, 'password attempts')
    const u = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) { this.byPassword.fail(userId); throw new UnauthorizedException("Current password is incorrect") }
    this.byPassword.clear(userId)
    // Every other device is signed out; this one gets fresh tokens so the person stays signed in here.
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false, tokenVersion: { increment: 1 } } })
    return { ok: true, ...(await this.tokens(userId, updated.tokenVersion)) }
  }

  /** Signs the person out of every device, including this one. */
  async logoutEverywhere(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })
    return { ok: true }
  }

  async refresh(token: string) {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; tv?: number }>(token, { secret: process.env.JWT_REFRESH_SECRET })
      const u = await this.prisma.user.findUnique({ where: { id: p.sub }, include: { school: { select: { active: true, isPlatform: true } } } })
      // A deactivated person, a suspended school, or a token from before "sign out everywhere" gets nothing new.
      if (!u || !u.active || (!u.school.active && !u.school.isPlatform) || (p.tv ?? 0) !== u.tokenVersion) throw new UnauthorizedException()
      return await this.tokens(u.id, u.tokenVersion)
    } catch {
      throw new UnauthorizedException()
    }
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService, private resets: PasswordResetService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, dto.school, req.ip)
  }

  /** Asks for a password reset link by email. Always answers the same, whether or not the address has an account. */
  @Post('forgot-password')
  forgot(@Body() dto: ForgotDto, @Req() req: Request) {
    return this.resets.request(dto.email, req.ip ?? 'unknown', dto.school)
  }

  /** Uses a reset link once to choose a new password. Signs the person out of every device. */
  @Post('reset-password')
  reset(@Body() dto: ResetDto, @Req() req: Request) {
    return this.resets.reset(dto.token, dto.newPassword, req.ip ?? 'unknown')
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

  @Post('logout-all')
  @UseGuards(AuthGuard)
  logoutAll(@CurrentUser() user: AuthUser) {
    return this.auth.logoutEverywhere(user.id)
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
  providers: [AuthService, AuthGuard, PermissionGuard, PasswordResetService],
  controllers: [AuthController],
  exports: [JwtModule, AuthGuard, PermissionGuard],
})
export class AuthModule {}
