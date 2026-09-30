import { Global, Injectable, Module } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { Server } from 'socket.io'

/**
 * Which screens a change touches. Derived from the audit action, because every approval, decision and edit already
 * writes one, so no page or module has to remember to announce itself. Home's to-do list refreshes on everything.
 */
export function kindsFor(action: string): string[] {
  const kinds = new Set<string>(['todo'])
  const a = action.toLowerCase()
  if (a.startsWith('leave.')) kinds.add('leave')
  if (a.includes('role_request')) kinds.add('role_requests')
  if (a.includes('waiver')) kinds.add('waivers')
  if (a.startsWith('fee')) kinds.add('fees')
  if (a.startsWith('results.') || a.startsWith('marks.') || a.startsWith('exam.')) kinds.add('results')
  if (a.startsWith('admission.') || a.startsWith('student.')) kinds.add('admissions')
  if (a.startsWith('announcement.')) kinds.add('announcements')
  if (a.startsWith('link.')) kinds.add('links')
  if (a.startsWith('user.')) kinds.add('users')
  if (a.startsWith('class.') || a.startsWith('channel.')) kinds.add('classes')
  if (a.startsWith('message.report')) kinds.add('message_reports')
  return [...kinds]
}

/**
 * Tells connected browsers "something changed" so queues refresh without a reload. The signal carries only a
 * category, never the data: each browser refetches through the normal API, which applies its own permissions.
 * Sockets join their school's room when they connect (see the chat gateway), so nothing crosses schools.
 */
@WebSocketGateway({ cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true } })
@Injectable()
export class LiveGateway {
  @WebSocketServer() server: Server
  private pending = new Map<string, { kinds: Set<string>; timer: NodeJS.Timeout }>()

  /** Batched for a moment: changes are logged inside their transaction, and this lets it commit before browsers refetch. */
  changed(schoolId: string, kinds: string[]) {
    const p = this.pending.get(schoolId) ?? { kinds: new Set<string>(), timer: undefined as unknown as NodeJS.Timeout }
    kinds.forEach((k) => p.kinds.add(k))
    if (!this.pending.has(schoolId)) {
      p.timer = setTimeout(() => {
        this.pending.delete(schoolId)
        this.server?.to(`school:${schoolId}`).emit('queue:changed', { kinds: [...p.kinds] })
      }, 300)
      this.pending.set(schoolId, p)
    }
  }
}

@Global()
@Module({ providers: [LiveGateway], exports: [LiveGateway] })
export class LiveModule {}
