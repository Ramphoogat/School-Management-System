import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.module'
import { sendEmail } from '../notifications/senders'
import { FailureLimiter } from './rate-limit'

export const RESET_MINUTES = 60
const HOUR = 60 * 60_000
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** The address people use to reach the web app: the first one in WEB_ORIGIN. */
export const webBase = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '')

/**
 * "I forgot my password". The person asks for a link by email, then uses it once to choose a new password.
 * The answer to a request is always the same, whether or not the email belongs to anyone, so it cannot be used to find out
 * who has an account.
 */
@Injectable()
export class PasswordResetService {
  private log = new Logger('PasswordReset')
  // Asking counts against the limit every time (not just failures): three links an hour per address, twenty per network.
  private askEmail = new FailureLimiter(3, HOUR)
  private askIp = new FailureLimiter(20, HOUR)
  private useIp = new FailureLimiter(20, 15 * 60_000)

  constructor(private prisma: PrismaService) {}

  async request(email: string, ip: string, school?: string) {
    const key = email.trim().toLowerCase()
    this.askEmail.check(key, 'password reset requests for this address')
    this.askIp.check(ip, 'password reset requests from this network')
    this.askEmail.fail(key)
    this.askIp.fail(ip)

    let schoolId: string | undefined
    if (school) {
      const s = await this.prisma.school.findFirst({ where: { slug: school.trim().toLowerCase(), isPlatform: false } })
      schoolId = s?.id ?? '__none__'
    }
    const users = await this.prisma.user.findMany({
      where: { email: { equals: key, mode: 'insensitive' }, active: true, ...(schoolId ? { schoolId } : {}) },
      include: { school: { select: { active: true, isPlatform: true, slug: true, name: true } } },
    })
    for (const u of users) {
      if (!u.school.active && !u.school.isPlatform) continue // a suspended school is locked out, including this
      const secret = randomBytes(32).toString('base64url')
      // Only the newest link works.
      await this.prisma.passwordReset.deleteMany({ where: { userId: u.id } })
      await this.prisma.passwordReset.create({ data: { userId: u.id, tokenHash: sha(secret), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } })
      const link = `${webBase()}/reset-password?token=${secret}${u.school.slug && !u.school.isPlatform ? `&school=${encodeURIComponent(u.school.slug)}` : ''}`
      const where = u.school.isPlatform ? 'the school platform' : u.school.name
      // Not awaited: how long sending takes must not tell an outsider whether the address exists.
      void sendEmail(u.email, 'Reset your password', [
        `Hello ${u.name},`, '',
        `Someone asked to reset the password for your account at ${where}. To choose a new password, open this link within ${RESET_MINUTES} minutes:`, '',
        link, '',
        'It can be used once. If you did not ask for this, ignore this message: your password has not been changed.',
      ].join('\n')).catch((e: Error) => this.log.warn(`Could not send a password reset email: ${e.message}`))
    }
    return { ok: true }
  }

  async reset(token: string, newPassword: string, ip: string) {
    this.useIp.check(ip, 'attempts')
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha(token) }, include: { user: { include: { school: { select: { active: true, isPlatform: true } } } } } })
    const u = row?.user
    if (!row || row.usedAt || row.expiresAt < new Date() || !u || !u.active || (!u.school.active && !u.school.isPlatform)) {
      this.useIp.fail(ip)
      throw new BadRequestException('This link is not valid any more. Ask for a new one.')
    }
    // One use only: claim it first, so two clicks at once cannot both succeed.
    const claimed = await this.prisma.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (claimed.count !== 1) throw new BadRequestException('This link is not valid any more. Ask for a new one.')
    await this.prisma.user.update({
      where: { id: u.id },
      // Signs the person out everywhere, and clears a temporary-password flag: they just chose their own.
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
    })
    await this.prisma.passwordReset.deleteMany({ where: { userId: u.id, id: { not: row.id } } })
    await this.prisma.auditLog.create({ data: { schoolId: u.schoolId, actorId: u.id, action: 'auth.password_reset', resource: 'user', resourceId: u.id } })
    return { ok: true }
  }
}
