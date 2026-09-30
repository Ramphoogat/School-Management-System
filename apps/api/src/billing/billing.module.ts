import { Controller, ForbiddenException, Get, Global, Injectable, Module, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.module'
import { AuthGuard, CurrentUser, PermissionGuard, RequirePermission, type AuthUser } from '../auth/guards'

/** How a school stands with its plan. */
export type BillingStatus = 'none' | 'active' | 'expiring' | 'grace' | 'overdue'
/** Days before the end when the school is told the plan is running out. */
export const EXPIRING_DAYS = 14
/** Days after the end during which nothing is blocked. After that the school cannot add students until it renews. */
export const GRACE_DAYS = 14

const dayNumber = (d: Date) => Math.floor(d.getTime() / 86_400_000)
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Pure, so it can be tested without a database. `endsOn` is the last paid day. */
export function billingStatus(hasPlan: boolean, endsOn: Date | null, now = new Date()): { status: BillingStatus; daysLeft: number | null } {
  if (!hasPlan) return { status: 'none', daysLeft: null }
  if (!endsOn) return { status: 'active', daysLeft: null } // a plan with no end date never runs out
  const daysLeft = dayNumber(endsOn) - dayNumber(utcDay(now))
  if (daysLeft > EXPIRING_DAYS) return { status: 'active', daysLeft }
  if (daysLeft >= 0) return { status: 'expiring', daysLeft }
  return { status: -daysLeft <= GRACE_DAYS ? 'grace' : 'overdue', daysLeft }
}

/** Adds calendar months to a date without overflowing into the next month (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)))
}

@Injectable()
export class PlanService {
  constructor(private prisma: PrismaService) {}

  /** What a school is on and how much of it is used. */
  async summary(schoolId: string) {
    const [school, students] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, include: { plan: true } }),
      this.prisma.user.count({ where: { schoolId, role: 'student', active: true } }),
    ])
    const { status, daysLeft } = billingStatus(!!school.plan, school.planEndsOn)
    return {
      plan: school.plan ? { id: school.plan.id, name: school.plan.name, maxStudents: school.plan.maxStudents, priceMonthly: school.plan.priceMonthly } : null,
      students,
      endsOn: school.planEndsOn ? school.planEndsOn.toISOString().slice(0, 10) : null,
      status,
      daysLeft,
    }
  }

  /**
   * Called before a student account is created. A school with no plan is never limited. With a plan, it cannot go over the
   * plan's student limit, and cannot add students once the plan has been expired for longer than the grace period.
   */
  async assertStudentRoom(schoolId: string, adding = 1) {
    const s = await this.summary(schoolId)
    if (!s.plan) return
    if (s.status === 'overdue') throw new ForbiddenException("This school's plan ran out more than two weeks ago. Ask the platform administrator to renew it before adding students.")
    if (s.plan.maxStudents > 0 && s.students + adding > s.plan.maxStudents) {
      throw new ForbiddenException(`The ${s.plan.name} plan allows up to ${s.plan.maxStudents} students and this school has ${s.students}. Ask the platform administrator to change the plan.`)
    }
  }
}

/** The school's own view of its plan (admin and principal). */
@Controller('school')
@UseGuards(AuthGuard, PermissionGuard)
export class SchoolBillingController {
  constructor(private plans: PlanService) {}

  @Get('billing')
  @RequirePermission('billing', 'read')
  billing(@CurrentUser() user: AuthUser) {
    if (!user.schoolId) throw new ForbiddenException()
    return this.plans.summary(user.schoolId)
  }
}

@Global()
@Module({ providers: [PlanService], controllers: [SchoolBillingController], exports: [PlanService] })
export class BillingModule {}
