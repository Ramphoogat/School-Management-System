import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Megaphone } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

type Mark = 'present' | 'absent' | 'late' | 'leave'
type Look = Mark | 'leave' | 'none'

interface Leave { id: string; fromDate: string; toDate: string; status: string; reason: string; decisionNote: string | null; decidedBy: string | null }
interface Message { id: string; title: string; body: string; urgent: boolean; createdAt: string; scope: 'class' | 'school'; authorName: string; authorRole: string | null }
interface Homework { id: string; title: string; description: string; dueDate: string; createdAt: string; authorName: string }
interface Data { student: { id: string; name: string }; month: string; days: { date: string; status: Mark }[]; leaves: Leave[]; messages: Message[]; homework: Homework[] }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const localDay = (d: string) => { const x = new Date(d); return iso(x.getFullYear(), x.getMonth() + 1, x.getDate()) }
const todayIso = () => { const x = new Date(); return iso(x.getFullYear(), x.getMonth() + 1, x.getDate()) }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const LOOK: Record<Look, { cell: string; label: string; dot: string }> = {
  present: { cell: 'border-emerald-500/50 bg-emerald-500/20', label: 'In school', dot: 'bg-emerald-500' },
  late: { cell: 'border-amber-500/60 bg-amber-500/20', label: 'Late', dot: 'bg-amber-500' },
  absent: { cell: 'border-red-500/70 bg-red-500/30', label: 'Absent', dot: 'bg-red-500' },
  leave: { cell: 'border-dashed border-red-500/70 bg-red-500/10', label: 'On leave', dot: 'bg-red-500/40 ring-1 ring-red-500' },
  none: { cell: 'border-transparent', label: 'No record', dot: 'bg-muted-foreground/40' },
}

const role = (r: string | null) => (r ? r[0].toUpperCase() + r.slice(1) : 'School')

/** A month of school days in green and red, with what the school said on each day when you click it. */
export function AttendanceCalendar({ students }: { students: { id: string; name: string }[] }) {
  const { t } = useT()
  const now = new Date()
  const [studentId, setStudentId] = useState(students[0]?.id ?? '')
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [data, setData] = useState<Data | null>(null)
  const [picked, setPicked] = useState<string>(todayIso())

  useEffect(() => { if (!studentId && students[0]) setStudentId(students[0].id) }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    setData(null)
    api<Data>(`/attendance/student/${studentId}/calendar?month=${ym.y}-${pad(ym.m)}`).then(setData).catch((e) => toast.error(e.message))
  }, [studentId, ym])

  const marks = useMemo(() => new Map(data?.days.map((d) => [d.date, d.status]) ?? []), [data])
  const approved = useMemo(() => (data?.leaves ?? []).filter((l) => l.status === 'approved'), [data])
  // What the teacher recorded wins (it can override); a day with no record inside an approved leave shows as leave.
  const look = (d: string): Look => {
    const m = marks.get(d)
    if (m) return m
    return approved.some((l) => l.fromDate <= d && d <= l.toDate) ? 'leave' : 'none'
  }
  const msgsOn = (d: string) => (data?.messages ?? []).filter((m) => localDay(m.createdAt) === d)
  const workOn = (d: string) => (data?.homework ?? []).filter((h) => h.dueDate === d || localDay(h.createdAt) === d)

  const first = new Date(ym.y, ym.m - 1, 1)
  const days = new Date(ym.y, ym.m, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday first
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(ym.y, ym.m, i + 1))]

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, leave: 0 }
    for (let d = 1; d <= days; d++) { const l = look(iso(ym.y, ym.m, d)); if (l !== 'none') c[l]++ }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, approved, ym, days])
  const attended = counts.present + counts.late
  const school = attended + counts.absent
  const pct = school ? Math.round((attended / school) * 100) : null

  const move = (delta: number) => {
    const d = new Date(ym.y, ym.m - 1 + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() + 1 })
    setPicked('')
  }
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const today = todayIso()

  const pickedLook = picked ? look(picked) : 'none'
  const leaveOn = picked ? (data?.leaves ?? []).filter((l) => l.fromDate <= picked && picked <= l.toDate) : []
  const pickedMsgs = picked ? msgsOn(picked) : []
  const pickedWork = picked ? workOn(picked) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {students.length > 1 && (
          <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={studentId} onChange={(e) => { setStudentId(e.target.value); setPicked('') }} aria-label={t('Child')}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => move(-1)} aria-label={t('Previous month')}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-36 text-center font-medium">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => move(1)} aria-label={t('Next month')}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }); setPicked(today) }}>{t('Today')}</Button>
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(['present', 'late', 'absent', 'leave'] as Look[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm border ${LOOK[k].cell}`} />{LOOK[k].label}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {DOW.map((d) => <div key={d} className="pb-1 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`b${i}`} />
              const l = look(d)
              const n = msgsOn(d).length + workOn(d).length
              return (
                <button
                  key={d} type="button" onClick={() => setPicked(d)}
                  aria-label={`${d}: ${LOOK[l].label}${n ? `, ${n} update(s)` : ''}`} aria-pressed={picked === d}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition hover:brightness-110 ${LOOK[l].cell} ${picked === d ? 'ring-2 ring-primary' : ''} ${d === today ? 'font-bold' : ''}`}
                >
                  <span>{Number(d.slice(8))}</span>
                  {d === today && <span className="absolute bottom-1 text-[9px] font-semibold uppercase tracking-wide text-primary">{t('today')}</span>}
                  {n > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" title={`${n} update(s)`} />}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'In school', value: attended, tone: 'text-emerald-500' },
              { label: 'Absent', value: counts.absent, tone: 'text-red-500' },
              { label: 'On leave', value: counts.leave, tone: 'text-red-400' },
              { label: 'Attendance', value: pct === null ? '—' : `${pct}%`, tone: '' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {!data && <p className="text-sm text-muted-foreground">{t('Loading…')}</p>}
        </div>

        <aside className="space-y-4 rounded-xl border bg-card p-4 lg:sticky lg:top-0 lg:self-start" aria-live="polite">
          {!picked ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" /> {t('Choose a date to see what happened that day.')}</p>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted-foreground">{new Date(`${picked}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-sm border ${LOOK[pickedLook].cell}`} />
                  <span className="font-semibold">{LOOK[pickedLook].label}</span>
                </div>
              </div>

              {leaveOn.map((l) => (
                <div key={l.id} className="space-y-1 rounded-lg border border-dashed border-red-500/50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t('Leave request')}</span>
                    <Badge variant={l.status === 'rejected' ? 'destructive' : l.status === 'approved' ? 'default' : 'secondary'} className="capitalize">{l.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} to ${l.toDate}`}</p>
                  <p className="whitespace-pre-wrap break-words">{l.reason}</p>
                  {l.decisionNote && <p className="text-xs text-muted-foreground">{t('Note')}{l.decidedBy ? ` from ${l.decidedBy}` : ''}: {l.decisionNote}</p>}
                </div>
              ))}

              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Megaphone className="h-4 w-4" /> {t('Messages')}</h3>
                {pickedMsgs.length === 0 && <p className="text-sm text-muted-foreground">{t('No messages from the school on this day.')}</p>}
                {pickedMsgs.map((m) => (
                  <article key={m.id} className="space-y-1 rounded-lg bg-muted p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{m.title}</span>
                      {m.urgent && <Badge variant="destructive">{t('Urgent')}</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.authorName} ({role(m.authorRole)}) · {m.scope === 'school' ? 'Whole school' : 'Your class'} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </article>
                ))}
              </section>

              {pickedWork.length > 0 && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><BookOpen className="h-4 w-4" /> {t('Homework')}</h3>
                  {pickedWork.map((h) => (
                    <div key={h.id} className="space-y-0.5 rounded-lg bg-muted p-3 text-sm">
                      <p className="font-medium">{h.title}</p>
                      <p className="text-xs text-muted-foreground">{h.dueDate === picked ? 'Due today' : `Due ${h.dueDate}`} · set by {h.authorName}</p>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
