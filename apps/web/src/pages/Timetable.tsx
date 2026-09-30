import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

interface Slot { id?: string; classId: string; className?: string; dayOfWeek: number; period: number; startTime: string; endTime: string; subject: string; teacherId?: string | null; teacherName?: string | null }
interface Cls { id: string; name: string }

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'

/** Same subject, same colour, in light and dark themes. */
const hue = (s: string) => [...s.toLowerCase()].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const addMinutes = (t: string, n: number) => { const m = Math.min(mins(t) + n, 23 * 60 + 59); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const todayDow = () => ((new Date().getDay() + 6) % 7) + 1 // 1 = Monday

/**
 * One row per time slot (not per period number), so classes that run on different bell times
 * never get each other's times. Columns are equal width; Sunday only appears if something is on it.
 */
function Grid({ slots, showClass }: { slots: Slot[]; showClass: boolean }) {
  const { t } = useT()
  const days = useMemo(() => (slots.some((s) => s.dayOfWeek === 7) ? 7 : 6), [slots])
  const rows = useMemo(() => {
    const m = new Map<string, { start: string; end: string; period: number }>()
    for (const s of slots) { const k = `${s.startTime}-${s.endTime}`; if (!m.has(k)) m.set(k, { start: s.startTime, end: s.endTime, period: s.period }) }
    return [...m.entries()].sort((a, b) => a[1].start.localeCompare(b[1].start))
  }, [slots])
  const today = todayDow()

  return (
    <div tabIndex={0} className="overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-ring">
      <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-28" />
          {Array.from({ length: days }, (_, i) => <col key={i} />)}
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">{t('Time')}</th>
            {DAY_NAMES.slice(0, days).map((d, i) => (
              <th key={d} className={`px-3 py-2 font-medium ${i + 1 === today ? 'text-foreground' : ''}`}>
                {d}{i + 1 === today && <span className="ml-1 rounded bg-primary px-1 py-px text-[10px] normal-case text-primary-foreground">{t('today')}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, r]) => (
            <tr key={key} className="border-b last:border-0 align-top">
              <td className="px-3 py-2 text-xs">
                <div className="font-medium">{r.start}–{r.end}</div>
                <div className="text-muted-foreground">{t('Period {period}', { period: r.period })}</div>
              </td>
              {Array.from({ length: days }, (_, i) => {
                const here = slots.filter((s) => s.dayOfWeek === i + 1 && `${s.startTime}-${s.endTime}` === key)
                return (
                  <td key={i} className={`space-y-1 px-1.5 py-1.5 ${i + 1 === today ? 'bg-primary/5' : ''}`}>
                    {here.map((s) => (
                      <div key={s.id ?? `${s.classId}-${s.period}-${s.dayOfWeek}`} className="rounded-md border-l-4 px-2 py-1"
                        style={{ borderLeftColor: `hsl(${hue(s.subject)} 60% 50%)`, backgroundColor: `hsl(${hue(s.subject)} 70% 50% / 0.13)` }}>
                        <div className="font-medium leading-tight">{s.subject}</div>
                        {showClass && s.className && <div className="text-xs">{s.className}</div>}
                        {s.teacherName && <div className="truncate text-xs text-muted-foreground">{s.teacherName}</div>}
                      </div>
                    ))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The other-class period that already books this teacher at the same day and time, if any. */
function clash(r: Slot, teacherId: string | null | undefined, others: Slot[]) {
  if (!teacherId || !r.startTime || !r.endTime || r.endTime <= r.startTime) return undefined
  return others.find((o) => o.teacherId === teacherId && o.dayOfWeek === r.dayOfWeek && mins(r.startTime) < mins(o.endTime) && mins(o.startTime) < mins(r.endTime))
}

/** Problems worth showing before the server has to say no. */
function problems(rows: Slot[], others: Slot[]) {
  const out = new Map<number, string>()
  rows.forEach((r, i) => {
    if (!r.subject.trim()) out.set(i, 'Add a subject')
    else if (!r.startTime || !r.endTime || r.endTime <= r.startTime) out.set(i, 'End time must be after the start time')
    else if (rows.some((o, j) => j < i && o.dayOfWeek === r.dayOfWeek && o.period === r.period)) out.set(i, 'This day and period is already used')
    else if (rows.some((o, j) => j !== i && o.dayOfWeek === r.dayOfWeek && o.startTime && o.endTime && mins(r.startTime) < mins(o.endTime) && mins(o.startTime) < mins(r.endTime))) out.set(i, 'Overlaps another period on this day')
    else { const c = clash(r, r.teacherId, others); if (c) out.set(i, `${c.teacherName ?? 'This teacher'} is teaching ${c.className ?? 'another class'} at ${c.startTime}–${c.endTime}. Pick another teacher or time.`) }
  })
  return out
}

function Editor({ classes, initial, onDone }: { classes: Cls[]; initial: string; onDone: () => void }) {
  const { t: tr } = useT()
  const [teachers, setTeachers] = useState<Cls[]>([])
  const [classId, setClassId] = useState(initial || classes[0]?.id || '')
  const [rows, setRows] = useState<Slot[]>([])
  // Periods other classes already give each teacher, so a clash shows up before Save instead of after.
  const [everyone, setEveryone] = useState<Slot[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api<Cls[]>('/users/directory?role=teacher').then(setTeachers).catch(() => setTeachers([])) }, [])
  useEffect(() => { api<Slot[]>('/timetable/me').then(setEveryone).catch(() => setEveryone([])) }, [])
  const others = useMemo(() => everyone.filter((o) => o.classId !== classId && o.teacherId), [everyone, classId])
  const load = useCallback(async () => {
    if (!classId) return
    const r = await api<Slot[]>(`/timetable/class/${classId}`)
    setRows(r.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.period - b.period)); setDirty(false)
  }, [classId])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  const issues = useMemo(() => problems(rows, others), [rows, others])
  const update = (i: number, patch: Partial<Slot>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true) }
  // A new period continues the day: next period number, starting when the last one ended.
  const add = () => {
    setRows((r) => {
      const last = r.at(-1)
      const start = last?.endTime ?? '09:00'
      return [...r, { classId, dayOfWeek: last?.dayOfWeek ?? 1, period: (last?.period ?? 0) + 1, startTime: start, endTime: addMinutes(start, 45), subject: '' }]
    })
    setDirty(true)
  }
  const copyDay = (from: number, to: number) => {
    const src = rows.filter((r) => r.dayOfWeek === from)
    if (!src.length) return toast.info(`${DAY_NAMES[from - 1]} has no periods to copy`)
    setRows((r) => [...r.filter((x) => x.dayOfWeek !== to), ...src.map((s) => ({ ...s, id: undefined, dayOfWeek: to }))].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.period - b.period))
    setDirty(true)
  }

  const save = async () => {
    setBusy(true)
    try {
      const slots = rows.map(({ dayOfWeek, period, startTime, endTime, subject, teacherId }) => ({ dayOfWeek, period, startTime, endTime, subject: subject.trim(), teacherId: teacherId || undefined }))
      const saved = await api<Slot[]>(`/timetable/class/${classId}`, { method: 'PUT', body: { slots } })
      setRows(saved); setDirty(false)
      toast.success(tr('Timetable saved'))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const switchClass = (id: string) => {
    if (dirty && !window.confirm(tr('You have unsaved changes. Switch class and lose them?'))) return
    setClassId(id)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectCls} value={classId} onChange={(e) => switchClass(e.target.value)} aria-label={tr('Class')}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={add}>{tr('Add period')}</Button>
        <select className={selectCls} value="" onChange={(e) => { const [f, t] = e.target.value.split('>').map(Number); if (f && t) copyDay(f, t); e.target.value = '' }} aria-label={tr('Copy a day')}>
          <option value="">{tr('Copy a day…')}</option>
          {DAY_NAMES.slice(0, 6).flatMap((_, f) => DAY_NAMES.slice(0, 6).flatMap((__, t) => (f === t ? [] : [<option key={`${f}${t}`} value={`${f + 1}>${t + 1}`}>{DAY_NAMES[f]} → {DAY_NAMES[t]}</option>])))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">{tr('Unsaved changes')}</span>}
          <Button size="sm" onClick={save} disabled={busy || !classId || issues.size > 0 || !dirty}>{busy ? 'Saving…' : 'Save timetable'}</Button>
          <Button size="sm" variant="outline" onClick={() => { if (!dirty || window.confirm(tr('Leave without saving?'))) onDone() }}>{tr('Done')}</Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i}>
            <div className="flex flex-wrap items-center gap-2">
              <select className={selectCls} value={r.dayOfWeek} onChange={(e) => update(i, { dayOfWeek: +e.target.value })} aria-label={tr('Day')}>
                {DAY_NAMES.map((d, k) => <option key={d} value={k + 1}>{d}</option>)}
              </select>
              <Input className="w-16" type="number" min={1} max={20} value={r.period} onChange={(e) => update(i, { period: +e.target.value })} aria-label={tr('Period')} />
              <Input className="w-28" type="time" value={r.startTime} onChange={(e) => update(i, { startTime: e.target.value })} aria-label={tr('Start time')} />
              <span className="text-muted-foreground">{tr('to')}</span>
              <Input className="w-28" type="time" value={r.endTime} onChange={(e) => update(i, { endTime: e.target.value })} aria-label={tr('End time')} />
              <Input className="w-40" placeholder={tr('Subject')} value={r.subject} onChange={(e) => update(i, { subject: e.target.value })} aria-label={tr('Subject')} />
              <select className={selectCls} value={r.teacherId ?? ''} onChange={(e) => update(i, { teacherId: e.target.value || null })} aria-label={tr('Teacher')}>
                <option value="">{tr('No teacher')}</option>
                {teachers.map((t) => {
                  const c = clash(r, t.id, others)
                  return <option key={t.id} value={t.id} disabled={!!c && t.id !== r.teacherId}>{t.name}{c ? ` (busy: ${c.className} ${c.startTime}–${c.endTime})` : ''}</option>
                })}
              </select>
              <Button variant="ghost" size="sm" onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); setDirty(true) }}>{tr('Remove')}</Button>
            </div>
            {issues.has(i) && <p className="ml-1 mt-1 text-xs text-destructive">{issues.get(i)}</p>}
            {r.teacherId && !issues.has(i) && (() => {
              const same = others.filter((o) => o.teacherId === r.teacherId && o.dayOfWeek === r.dayOfWeek).sort((a, b) => a.startTime.localeCompare(b.startTime))
              return same.length > 0 && <p className="ml-1 mt-1 text-xs text-muted-foreground">{tr('Also teaches on {value}: {value2}', { value: DAY_NAMES[r.dayOfWeek - 1], value2: same.map((o) => `${o.className} ${o.startTime}–${o.endTime}`).join(', ') })}</p>
            })()}
          </div>
        ))}
        {rows.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{tr('No periods yet. Use “Add period” to start this class’s week.')}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{tr('One teacher can take several classes. Teachers already booked at that day and time are greyed out, and their other classes that day are shown under the row.')}</p>
    </div>
  )
}

export default function Timetable() {
  const { t } = useT()
  const { user, can } = useAuth()
  const canEdit = can('timetable', 'write')
  const [slots, setSlots] = useState<Slot[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // class id being edited
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (editing !== null) return
    Promise.all([api<Slot[]>('/timetable/me'), api<Cls[]>('/classes')])
      .then(([s, c]) => { setSlots(s); setClasses(c) })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoaded(true))
  }, [editing])

  // Every class the person can see, including ones with no timetable yet, plus classes a teacher only teaches in.
  const all = useMemo(() => {
    const m = new Map<string, string>(classes.map((c) => [c.id, c.name]))
    for (const s of slots) if (!m.has(s.classId) && s.className) m.set(s.classId, s.className)
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [classes, slots])

  const mine = useMemo(() => (user?.role === 'teacher' ? slots.filter((s) => s.teacherId === user.id) : []), [slots, user])
  const shown = filter ? all.filter((c) => c.id === filter) : all

  if (editing !== null) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('Edit timetable')}</h1>
        <Editor classes={all} initial={editing} onDone={() => setEditing(null)} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{t('Timetable')}</h1>
        {all.length > 1 && (
          <select className={selectCls} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('Filter by class')}>
            <option value="">{t('All classes')}</option>
            {all.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {canEdit && all.length > 0 && <Button className="ml-auto" size="sm" variant="outline" onClick={() => setEditing(filter || all[0].id)}>{t('Edit timetable')}</Button>}
      </div>

      {!loaded && <p className="text-muted-foreground">{t('Loading…')}</p>}

      {loaded && all.length === 0 && (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('You are not in any class yet, so there is no timetable to show.')} {canEdit ? 'Create a class first.' : ''}
        </p>
      )}

      {mine.length > 0 && !filter && (
        <section className="space-y-2">
          <h2 className="font-medium">{t('My teaching schedule')}</h2>
          <Grid slots={mine} showClass />
        </section>
      )}

      {shown.map((c) => {
        const own = slots.filter((s) => s.classId === c.id)
        return (
          <section key={c.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">{c.name}</h2>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(c.id)}>{own.length ? 'Edit' : 'Set up'}</Button>}
            </div>
            {own.length > 0 ? <Grid slots={own} showClass={false} /> : (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No timetable for {c.name} yet.{canEdit ? ' Use “Set up” to add its periods.' : ' The principal or admin sets it up.'}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
