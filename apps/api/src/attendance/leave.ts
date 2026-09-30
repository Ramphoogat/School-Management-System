import type { Prisma } from '@school/db'
import type { PrismaService } from '../prisma/prisma.module'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`)

/**
 * The days that count for a student's attendance percentage. Leave days are excused: they are neither attended nor
 * missed, so they stay out of both sides of the sum. Everything else counts, and only absent is a miss.
 */
export function attendanceStats(rows: { status: string }[]) {
  const counted = rows.filter((r) => r.status !== 'leave')
  const attended = counted.filter((r) => r.status !== 'absent').length
  return { days: counted.length, attended, percent: counted.length ? Math.round((attended / counted.length) * 100) : null }
}

/** Which of these students have an approved leave covering the date, with the reason. */
export async function studentsOnLeave(prisma: PrismaService | Prisma.TransactionClient, studentIds: string[], date: string) {
  if (!studentIds.length) return new Map<string, { reason: string }>()
  const d = toDate(date)
  const rows = await prisma.leaveRequest.findMany({
    where: { subjectUserId: { in: studentIds }, status: 'approved', fromDate: { lte: d }, toDate: { gte: d } },
    select: { subjectUserId: true, reason: true },
  })
  return new Map(rows.map((r) => [r.subjectUserId, { reason: r.reason }]))
}

/**
 * A leave was just approved for a student: any day in that range the teacher already marked absent becomes "leave", so an
 * approved absence is not held against them. Days marked present or late are left alone, and days not marked yet are
 * handled when the roster opens. Returns how many days changed.
 */
export async function applyApprovedLeave(
  tx: Prisma.TransactionClient,
  leave: { schoolId: string; subjectUserId: string; fromDate: Date; toDate: Date },
  actorId: string,
): Promise<number> {
  const student = await tx.user.findFirst({ where: { id: leave.subjectUserId, role: 'student' }, select: { id: true } })
  if (!student) return 0 // teachers and clerks ask for leave too; they have no attendance
  const r = await tx.attendance.updateMany({
    where: { studentId: student.id, status: 'absent', date: { gte: leave.fromDate, lte: leave.toDate } },
    data: { status: 'leave', markedById: actorId },
  })
  if (r.count > 0) {
    await tx.auditLog.create({ data: { schoolId: leave.schoolId, actorId, action: 'attendance.leave_applied', resource: 'attendance', resourceId: student.id, meta: { from: isoDay(leave.fromDate), to: isoDay(leave.toDate), days: r.count } } })
  }
  return r.count
}
