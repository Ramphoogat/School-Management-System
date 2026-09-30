import { Shield } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { usePresence } from '@/lib/presence'

export interface Member { id: string; name: string; role: string }

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export function StatusDot({ state, className = '' }: { state: 'online' | 'offline' | 'invisible'; className?: string }) {
  const color = state === 'online' ? 'bg-emerald-500' : state === 'invisible' ? 'border-2 border-muted-foreground bg-card' : 'bg-muted-foreground/60'
  return <span className={`inline-block h-3 w-3 rounded-full ring-2 ring-card ${color} ${className}`} title={state} />
}

function Row({ m, state, you, monitor }: { m: Member; state: 'online' | 'offline' | 'invisible'; you: boolean; monitor: boolean }) {
  const { t } = useT()
  return (
    <li className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${state === 'online' ? '' : 'opacity-60'}`}>
      <span className="relative shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{initials(m.name)}</span>
        <StatusDot state={state} className="absolute -bottom-0.5 -right-0.5" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{m.name}{you && <span className="text-muted-foreground"> {t('(you)')}</span>}{monitor && <Shield className="ml-1 inline h-3.5 w-3.5 text-primary" aria-label={t('Class monitor')} />}</span>
        <span className="block truncate text-xs capitalize text-muted-foreground">{state === 'invisible' ? 'Invisible' : monitor ? 'Class monitor' : m.role}</span>
      </span>
    </li>
  )
}

/** Discord-style member list: who is online right now and who is not. */
export function MembersPanel({ members, monitorId, onPickMonitor }: { members: Member[] | null; monitorId?: string | null; onPickMonitor?: (studentId: string | null) => void }) {
  const { t } = useT()
  const { user } = useAuth()
  const { isOnline, myStatus } = usePresence()
  if (members === null) return <p className="p-3 text-sm text-muted-foreground">{t('Loading members…')}</p>

  const byName = (a: Member, b: Member) => a.name.localeCompare(b.name)
  const on = members.filter((m) => isOnline(m.id)).sort(byName)
  const off = members.filter((m) => !isOnline(m.id)).sort(byName)
  const stateOf = (m: Member) => (m.id === user?.id && myStatus === 'invisible' ? 'invisible' : isOnline(m.id) ? 'online' : 'offline')

  const group = (title: string, list: Member[]) =>
    list.length > 0 && (
      <section>
        <h3 className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title} — {list.length}</h3>
        <ul>{list.map((m) => <Row key={m.id} m={m} state={stateOf(m)} you={m.id === user?.id} monitor={m.id === monitorId} />)}</ul>
      </section>
    )

  const students = members.filter((m) => m.role === 'student')
  return (
    <div>
      {onPickMonitor && (
        <div className="space-y-1 border-b px-2 pb-3 pt-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="monitor-pick">{t('Class monitor')}</label>
          <select id="monitor-pick" value={monitorId ?? ''} onChange={(e) => onPickMonitor(e.target.value || null)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="">{t('No monitor')}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {group('Online', on)}
      {group('Offline', off)}
      {members.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('No members in this class yet.')}</p>}
    </div>
  )
}
