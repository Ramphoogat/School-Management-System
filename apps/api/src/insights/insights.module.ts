import { Controller, ForbiddenException, Get, Module, UseGuards } from '@nestjs/common'
import { can, roleCan } from '@school/permissions'
import { attendanceStats } from '../attendance/leave'
import { ATTENDANCE_MIN_DAYS, ATTENDANCE_THRESHOLD, ATTENDANCE_WINDOW_DAYS } from '../attendance/threshold'
import { unreadMessages } from '../messages/messages.module'
import { PrismaService } from '../prisma/prisma.module'
import { AuthGuard, CurrentUser, PermissionGuard, type AuthUser } from '../auth/guards'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const todayDate = () => new Date(`${isoDay(new Date())}T00:00:00.000Z`)
const daysAgo = (n: number) => new Date(todayDate().getTime() - n * 86_400_000)
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)

export type TodoItem = { key: string; label: string; count: number; path: string; tone: 'action' | 'warn' | 'info' }

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class InsightsController {
  constructor(private prisma: PrismaService) {}

  /** Counts of items waiting on this user across every approval queue they can act on. */
  private async queues(user: AuthUser): Promise<TodoItem[]> {
    const s = user.schoolId
    const items: TodoItem[] = []
    const add = async (ok: boolean, key: string, label: string, path: string, count: () => Promise<number>) => {
      if (!ok) return
      const n = await count()
      items.push({ key, label, count: n, path, tone: 'action' })
    }
    await add(roleCan(user.role, 'role_requests', 'approve'), 'role_requests', 'Role requests to review', '/approvals', () => this.prisma.roleRequest.count({ where: { schoolId: s, status: 'pending' } }))
    await add(roleCan(user.role, 'results', 'approve'), 'results', 'Exam results awaiting approval', '/result-approvals', () => this.prisma.exam.count({ where: { schoolId: s, status: 'submitted' } }))
    await add(roleCan(user.role, 'admissions', 'approve'), 'admissions', 'Admission applications to decide', '/admissions', () => this.prisma.admission.count({ where: { schoolId: s, status: 'pending' } }))
    await add(roleCan(user.role, 'fees', 'approve'), 'waivers', 'Fee waivers to decide', '/waivers', () => this.prisma.invoice.count({ where: { schoolId: s, waiverStatus: 'requested' } }))
    await add(roleCan(user.role, 'leave', 'approve'), 'leave', 'Leave requests to decide', '/leave', () => this.prisma.leaveRequest.count({ where: { schoolId: s, status: 'pending' } }))
    await add(roleCan(user.role, 'admissions', 'approve'), 'links', 'Parent links to approve', '/manage-links', () => this.prisma.parentStudentLink.count({ where: { schoolId: s, status: 'pending' } }))
    return items
  }

  /** Approvals center: every queue the user can act on, in one place. */
  @Get('approvals/summary')
  async approvals(@CurrentUser() user: AuthUser) {
    const items = await this.queues(user)
    if (!items.length) throw new ForbiddenException()
    return { total: items.reduce((a, i) => a + i.count, 0), items }
  }

  /** Home is a to-do list: what needs this user's action today. */
  @Get('home/todo')
  async todo(@CurrentUser() user: AuthUser) {
    const s = user.schoolId
    const today = todayDate()
    const items: TodoItem[] = []

    if (user.role === 'principal' || user.role === 'admin') items.push(...(await this.queues(user)))

    if (user.role === 'teacher') {
      const classes = await this.prisma.class.findMany({ where: { id: { in: user.classIds ?? [] } }, select: { id: true, name: true } })
      for (const c of classes) {
        const students = await this.prisma.classMember.count({ where: { classId: c.id, roleInClass: 'student' } })
        const marked = await this.prisma.attendance.count({ where: { classId: c.id, date: today } })
        if (students > 0 && marked === 0) items.push({ key: `att-${c.id}`, label: `Attendance not marked today: ${c.name}`, count: students, path: `/classes/${c.id}?channel=attendance`, tone: 'action' })
      }
      const drafts = await this.prisma.exam.count({ where: { schoolId: s, createdById: user.id, status: { in: ['draft', 'rejected'] } } })
      if (drafts) items.push({ key: 'drafts', label: 'Exams with marks still to enter or fix', count: drafts, path: classes[0] ? `/classes/${classes[0].id}?channel=grades` : '/', tone: 'action' })
    }

    if (user.role === 'clerk') {
      const [pending, overdue] = await Promise.all([
        this.prisma.admission.count({ where: { schoolId: s, status: 'pending' } }),
        this.prisma.invoice.count({ where: { schoolId: s, status: 'unpaid', dueDate: { lt: today } } }),
      ])
      if (pending) items.push({ key: 'adm', label: 'Admission applications waiting for approval', count: pending, path: '/admissions', tone: 'info' })
      if (overdue) items.push({ key: 'overdue', label: 'Overdue fee invoices', count: overdue, path: '/fees', tone: 'warn' })
    }

    if (user.role === 'student' || user.role === 'parent') {
      const kids = user.role === 'student' ? [user.id] : user.linkedStudentIds ?? []
      const names = new Map((await this.prisma.user.findMany({ where: { id: { in: kids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
      const who = (id: string) => (user.role === 'parent' ? `${names.get(id)}: ` : '')
      const classIds = (await this.prisma.classMember.findMany({ where: { userId: { in: kids } }, select: { classId: true, userId: true } }))
      for (const kid of kids) {
        const kClasses = classIds.filter((c) => c.userId === kid).map((c) => c.classId)
        const absent = await this.prisma.attendance.count({ where: { studentId: kid, date: today, status: 'absent' } })
        if (absent) items.push({ key: `abs-${kid}`, label: `${who(kid)}marked absent today`, count: 1, path: '/', tone: 'warn' })
        const rows = await this.prisma.attendance.findMany({ where: { studentId: kid, date: { gte: daysAgo(ATTENDANCE_WINDOW_DAYS) } }, select: { status: true } })
        const st = attendanceStats(rows)
        const p = st.percent
        if (p !== null && st.days >= ATTENDANCE_MIN_DAYS && p < ATTENDANCE_THRESHOLD) items.push({ key: `low-${kid}`, label: `${who(kid)}attendance is low (${p}%)`, count: 1, path: '/', tone: 'warn' })
        if (user.role === 'student') {
          const due = await this.prisma.assignment.findMany({ where: { classId: { in: kClasses }, dueDate: { gte: today } }, select: { id: true, classId: true, submissions: { where: { studentId: kid }, select: { id: true } } } })
          const todo = due.filter((a) => a.submissions.length === 0)
          if (todo.length) items.push({ key: 'hw', label: 'Homework due and not yet submitted', count: todo.length, path: `/classes/${todo[0].classId}?channel=homework`, tone: 'action' })
        }
        const unpaid = await this.prisma.invoice.count({ where: { studentId: kid, status: 'unpaid' } })
        if (unpaid) items.push({ key: `fee-${kid}`, label: `${who(kid)}fees to pay`, count: unpaid, path: '/fees', tone: 'action' })
        const fresh = await this.prisma.mark.count({ where: { studentId: kid, exam: { status: 'approved', decidedAt: { gte: daysAgo(7) } } } })
        if (fresh) items.push({ key: `res-${kid}`, label: `${who(kid)}new results published`, count: fresh, path: '/report-card', tone: 'info' })
      }
      if (user.role === 'parent') {
        const leaves = await this.prisma.leaveRequest.count({ where: { requesterId: user.id, status: 'pending' } })
        if (leaves) items.push({ key: 'myleave', label: 'Leave requests awaiting a decision', count: leaves, path: '/leave', tone: 'info' })
      }
    }
    if (roleCan(user.role, 'messages', 'write')) {
      const unread = await unreadMessages(this.prisma, user.id)
      if (unread > 0) items.push({ key: 'messages', label: 'Unread messages', count: unread, path: '/messages', tone: 'action' })
    }
    return { items }
  }

  /** Principal/admin dashboard numbers. */
  @Get('analytics/overview')
  async analytics(@CurrentUser() user: AuthUser) {
    // Leadership dashboard: principal and admin only (not every role that can read one dataset).
    if (!roleCan(user.role, 'users', 'manage') || !can(user, 'attendance', 'read') || !can(user, 'results', 'read') || !can(user, 'fees', 'read')) throw new ForbiddenException()
    const s = user.schoolId
    const today = todayDate()

    const [roles, classes, att, marks, invoices, students] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], where: { schoolId: s, active: true }, _count: true }),
      this.prisma.class.count({ where: { schoolId: s } }),
      this.prisma.attendance.findMany({ where: { schoolId: s, date: { gte: daysAgo(29) } }, select: { date: true, status: true, studentId: true, classId: true } }),
      this.prisma.mark.findMany({ where: { exam: { schoolId: s, status: 'approved' }, absent: false, score: { not: null } }, select: { score: true, exam: { select: { subject: true, maxMarks: true, classId: true } } } }),
      this.prisma.invoice.findMany({ where: { schoolId: s }, select: { amount: true, status: true, dueDate: true } }),
      this.prisma.user.findMany({ where: { schoolId: s, role: 'student', active: true }, select: { id: true, name: true } }),
    ])

    // Attendance: daily present rate for the last 14 days, today's counts, students under 75% over 30 days.
    const byDay = new Map<string, { p: number; t: number }>()
    for (const a of att) {
      if (a.status === 'leave') continue // excused days are not part of the rate
      const k = isoDay(a.date)
      const e = byDay.get(k) ?? { p: 0, t: 0 }
      e.t++; if (a.status !== 'absent') e.p++
      byDay.set(k, e)
    }
    const trend = Array.from({ length: 14 }, (_, i) => {
      const k = isoDay(daysAgo(13 - i)); const e = byDay.get(k)
      return { date: k, percent: e ? pct(e.p, e.t) : null, marked: e?.t ?? 0 }
    })
    const t = byDay.get(isoDay(today)) ?? { p: 0, t: 0 }
    const perStudent = new Map<string, { p: number; t: number }>()
    for (const a of att) { if (a.status === 'leave') continue; const e = perStudent.get(a.studentId) ?? { p: 0, t: 0 }; e.t++; if (a.status !== 'absent') e.p++; perStudent.set(a.studentId, e) }
    const nameOf = new Map(students.map((x) => [x.id, x.name]))
    const low = [...perStudent.entries()].map(([id, e]) => ({ id, name: nameOf.get(id) ?? '', percent: pct(e.p, e.t) ?? 0, days: e.t })).filter((x) => x.percent < ATTENDANCE_THRESHOLD && x.days >= ATTENDANCE_MIN_DAYS).sort((a, b) => a.percent - b.percent).slice(0, 10)

    // Results: average percent by subject.
    const subj = new Map<string, { s: number; m: number; n: number }>()
    for (const m of marks) { const e = subj.get(m.exam.subject) ?? { s: 0, m: 0, n: 0 }; e.s += m.score ?? 0; e.m += m.exam.maxMarks; e.n++; subj.set(m.exam.subject, e) }
    const subjects = [...subj.entries()].map(([subject, e]) => ({ subject, percent: pct(e.s, e.m) ?? 0, entries: e.n })).sort((a, b) => b.percent - a.percent)

    // Fees.
    const active = invoices.filter((i) => i.status !== 'waived')
    const billed = active.reduce((a, i) => a + i.amount, 0)
    const collected = active.filter((i) => i.status === 'paid').reduce((a, i) => a + i.amount, 0)
    const overdue = active.filter((i) => i.status === 'unpaid' && i.dueDate < today).reduce((a, i) => a + i.amount, 0)
    const waived = invoices.filter((i) => i.status === 'waived').reduce((a, i) => a + i.amount, 0)

    return {
      people: { ...Object.fromEntries(roles.map((r) => [r.role, r._count])), classes },
      attendance: { today: { present: t.p, marked: t.t, percent: pct(t.p, t.t) }, trend, low },
      results: { subjects },
      fees: { billed, collected, outstanding: billed - collected, overdue, waived, collectionRate: pct(collected, billed) },
    }
  }
}

@Module({ controllers: [InsightsController] })
export class InsightsModule {}
