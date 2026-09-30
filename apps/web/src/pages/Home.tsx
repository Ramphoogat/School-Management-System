import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Bell, CheckCheck, PartyPopper } from 'lucide-react'
import { api } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { useAuth } from '@/lib/auth'
import { navItems } from '@/lib/nav'
import { useT, type T } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Summary { student: { id: string; name: string }; percent: number | null; days: number; recent: { date: string; status: string }[] }
interface Note { id: string; subject: string; body: string; createdAt: string; readAt: string | null; urgent?: boolean }
interface Todo { key: string; label: string; count: number; path: string; tone: 'action' | 'warn' | 'info' }

const TONE: Record<Todo['tone'], string> = {
  action: 'bg-primary/15 text-primary',
  warn: 'bg-destructive/20 text-destructive-foreground',
  info: 'bg-secondary text-secondary-foreground',
}
const TONE_BAR: Record<Todo['tone'], string> = { action: 'bg-primary', warn: 'bg-destructive', info: 'bg-muted-foreground' }

const ROLE_BLURB: Record<string, string> = {
  student: 'Your classes, attendance and results in one place.',
  parent: 'Follow your children’s attendance, results and school updates.',
  teacher: 'Open a class on the left to take attendance or post updates.',
  clerk: 'Admissions, fees and certificates waiting for you.',
  principal: 'Decisions waiting for you come first.',
  admin: 'Approvals, people and school settings.',
}

function greeting(t: T) {
  const h = new Date().getHours()
  return t(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
}

function AttendanceCard({ studentId, showName }: { studentId: string; showName: boolean }) {
  const { t } = useT()
  const [s, setS] = useState<Summary | null>(null)
  useEffect(() => { api<Summary>(`/attendance/student/${studentId}`).then(setS).catch(() => setS(null)) }, [studentId])
  if (!s) return null
  const low = s.percent !== null && s.days >= 3 && s.percent < 75
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          {showName ? t('{name}: attendance', { name: s.student.name }) : t('Attendance')}
          {low && <Badge variant="destructive">{t('Low')}</Badge>}
        </CardTitle>
        <CardDescription>{s.percent === null ? t('No attendance recorded yet.') : t('Over the last {n} day(s)', { n: s.days })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {s.percent !== null && (
          <div>
            <p className="text-3xl font-semibold tabular-nums">{s.percent}%</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${low ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, s.percent)}%` }} />
            </div>
          </div>
        )}
        {s.recent.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {s.recent.map((r) => (
              <Badge key={r.date} variant={r.status === 'absent' ? 'destructive' : 'secondary'} title={r.date}>{r.date.slice(5)} {r.status[0].toUpperCase()}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Home is a to-do list: what needs my action today, before any report. */
function TodoList({ items }: { items: Todo[] | null }) {
  const { user, can } = useAuth()
  const { t } = useT()
  const open = items?.filter((i) => i.count > 0) ?? []
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('Needs your attention')}</CardTitle>
        <CardDescription>
          {items === null ? t('Loading…') : open.length === 0 ? t('You are all caught up.') : t('{n} thing(s) to look at', { n: open.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.map((i) => (
          <Link key={i.key} to={i.path} className="group flex items-center gap-3 overflow-hidden rounded-lg border p-3 text-sm transition hover:bg-accent">
            <span className={`h-8 w-1 shrink-0 rounded-full ${TONE_BAR[i.tone]}`} />
            <span className="min-w-0 flex-1 break-words font-medium leading-snug">{i.label}</span>
            <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold ${TONE[i.tone]}`}>{i.count}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
          </Link>
        ))}
        {items !== null && open.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <PartyPopper className="h-5 w-5 text-primary" /> {t('Nothing is waiting on you right now.')}
          </div>
        )}
        {(user?.role === 'principal' || user?.role === 'admin') && can('users', 'manage') && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="outline"><Link to="/approvals-center">{t('Approvals center')}</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/analytics">{t('School overview')}</Link></Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QuickLinks() {
  const { user, can } = useAuth()
  const { t } = useT()
  const links = navItems(can, user?.role).filter((n) => n.to !== '/settings').slice(0, 8)
  if (links.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('Quick links')}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="group flex flex-col gap-2 rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><l.icon className="h-5 w-5" /></span>
            <span className="text-sm font-medium leading-tight">{t(l.label)}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Notifications({ notes, onRead, onReadAll }: { notes: Note[]; onRead: (id: string) => void; onReadAll: () => void }) {
  const { t, locale } = useT()
  const unread = notes.filter((n) => !n.readAt).length
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Bell className="h-4 w-4 shrink-0" /> {t('Notifications')}
          {unread > 0 && <Badge>{t('{n} new', { n: unread })}</Badge>}
          {unread > 1 && <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={onReadAll}>{t('Mark all read')}</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[28rem] space-y-1 overflow-y-auto">
        {notes.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCheck className="h-4 w-4 shrink-0" /> {t('Nothing new. Alerts show up here.')}</p>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg p-2 text-sm hover:bg-accent/50">
            <div className="flex items-start gap-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`} />
              <p className={`min-w-0 flex-1 break-words font-medium ${n.readAt ? 'text-muted-foreground' : ''}`}>{n.subject}{n.urgent && <Badge variant="destructive" className="ml-2 align-middle">{t('Urgent')}</Badge>}</p>
              {!n.readAt && <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => onRead(n.id)}>{t('Mark read')}</Button>}
            </div>
            <p className="ml-4 mt-0.5 break-words text-muted-foreground">{n.body}</p>
            <p className="ml-4 mt-0.5 text-xs text-muted-foreground/70">{new Date(n.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function Home() {
  const { user } = useAuth()
  const { t, locale } = useT()
  const [todo, setTodo] = useState<Todo[] | null>(null)
  const [notes, setNotes] = useState<Note[]>([])

  const loadAll = useCallback(() => Promise.all([
    api<{ items: Todo[] }>('/home/todo').then((r) => setTodo(r.items)).catch(() => setTodo([])),
    api<Note[]>('/notifications').then(setNotes).catch(() => setNotes([])),
  ]), [])
  useEffect(() => { void loadAll() }, [loadAll])
  useLiveRefresh(['todo'], loadAll)

  const markRead = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'POST', body: {} })
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x)))
  }

  const markAllRead = async () => {
    const ids = notes.filter((n) => !n.readAt).map((n) => n.id)
    await Promise.all(ids.map((id) => api(`/notifications/${id}/read`, { method: 'POST', body: {} }).catch(() => undefined)))
    const now = new Date().toISOString()
    setNotes((all) => all.map((x) => (x.readAt ? x : { ...x, readAt: now })))
  }

  const today = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const attention = todo?.filter((i) => i.count > 0).length ?? 0
  const unread = notes.filter((n) => !n.readAt).length

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/25 via-primary/10 to-transparent p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <p className="text-sm text-muted-foreground">{today}</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{greeting(t)}, {user?.name?.split(' ')[0]}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{user && t(ROLE_BLURB[user.role])}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge className="capitalize">{user?.role && t(user.role)}</Badge>
          {attention > 0 && <Badge variant="secondary">{t('{n} to action', { n: attention })}</Badge>}
          {unread > 0 && <Badge variant="secondary">{t('{n} unread', { n: unread })}</Badge>}
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <TodoList items={todo} />
          <QuickLinks />
        </div>
        <div className="min-w-0 space-y-6">
          {user?.role === 'student' && <AttendanceCard studentId={user.id} showName={false} />}
          {user?.role === 'parent' && user.linkedStudentIds?.map((id) => <AttendanceCard key={id} studentId={id} showName />)}
          <Notifications notes={notes} onRead={markRead} onReadAll={markAllRead} />
        </div>
      </div>
    </div>
  )
}
