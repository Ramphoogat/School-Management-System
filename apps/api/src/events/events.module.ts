import { Global, Injectable, Logger, Module } from '@nestjs/common'

export type Channel = 'email' | 'whatsapp' | 'in_app'
export const CHANNELS: Channel[] = ['email', 'whatsapp', 'in_app']

export type EventMap = {
  'attendance.marked': { schoolId: string; classId: string; studentId: string; date: string; status: 'present' | 'absent' | 'late' | 'leave'; actorId: string }
  'announcement.posted': { schoolId: string; classId: string | null; announcementId: string; title: string; body: string; urgent: boolean; channels: Channel[]; actorId: string }
  'homework.assigned': { schoolId: string; classId: string; assignmentId: string; title: string; dueDate: string; channels: Channel[]; actorId: string }
  'leave.decided': { schoolId: string; leaveId: string; requesterId: string; subjectUserId: string; decision: 'approve' | 'reject'; fromDate: string; toDate: string; actorId: string }
  'leave.message': { schoolId: string; leaveId: string; authorId: string; authorName: string; requesterId: string; subjectUserId: string; decidedById: string | null }
  'student.admitted': { schoolId: string; studentId: string; parentId: string; classId: string; studentName: string; actorId: string }
  'dm.received': { schoolId: string; conversationId: string; recipientId: string; senderId: string; senderName: string; body?: string; attachments?: number; recipientOnline?: boolean }
  'dm.reported': { schoolId: string; reportId: string; conversationId: string; reporterId: string; participantIds: string[] }
  'dm.report_reviewed': { schoolId: string; reportId: string; reporterId: string; status: 'reviewed' | 'dismissed'; note?: string | null }
  'fee.due': { schoolId: string; invoiceId: string; studentId: string; title: string; amount: number; dueDate: string; daysLeft: number }
  'fee.overdue': { schoolId: string; invoiceId: string; studentId: string; title: string; amount: number; dueDate: string; daysLate: number }
  'fee.refunded': { schoolId: string; invoiceId: string; studentId: string; title: string; amount: number; actorId: string }
  'fee.paid': { schoolId: string; invoiceId: string; studentId: string; title: string; amount: number; actorId: string }
  'results.submitted': { schoolId: string; examId: string; classId: string; name: string; actorId: string }
  'results.approved': { schoolId: string; examId: string; studentId: string; examName: string; subject: string; score: number | null; maxMarks: number; actorId: string }
}
export type EventName = keyof EventMap

/**
 * In-process event bus. Feature modules publish; other modules subscribe.
 * Handler failures are logged and never break the publisher.
 */
@Injectable()
export class EventBus {
  private log = new Logger('EventBus')
  private handlers: { [K in EventName]?: Array<(p: EventMap[K]) => Promise<void> | void> } = {}

  on<K extends EventName>(name: K, fn: (p: EventMap[K]) => Promise<void> | void) {
    ;(this.handlers[name] ??= []).push(fn as never)
  }

  async emit<K extends EventName>(name: K, payload: EventMap[K]) {
    for (const fn of (this.handlers[name] ?? []) as Array<(p: EventMap[K]) => Promise<void> | void>) {
      try {
        await fn(payload)
      } catch (e) {
        this.log.error(`${name} handler failed: ${(e as Error).message}`)
      }
    }
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
