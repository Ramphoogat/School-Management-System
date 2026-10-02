import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, ChevronDown, ClipboardList, Clock, PartyPopper, Plus, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { dueLabel, matchesFilter, sortForStudent, summarize, toneOf, type HomeworkFilter, type HomeworkTone } from '@/lib/homework'
import { AttachButton, FileChips } from '@/components/HomeworkFiles'
import { ChannelPicker, type Channel } from '@/components/ChannelPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface Assignment {
  id: string; title: string; description?: string | null; dueDate: string
  files?: { id: string; name: string; size: number }[]
  myFiles?: { id: string; name: string; size: number }[]
  mySubmission?: { submittedAt: string; text?: string | null } | null
  submittedCount: number; studentCount?: number; canReview: boolean
}

/** Colour per state: a stripe on the card, and the due-date chip. */
const TONE: Record<HomeworkTone, { stripe: string; chip: string; Icon: typeof Clock }> = {
  overdue: { stripe: 'bg-destructive', chip: 'bg-destructive/10 text-destructive', Icon: AlertTriangle },
  soon: { stripe: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', Icon: Clock },
  open: { stripe: 'bg-primary', chip: 'bg-primary/10 text-primary', Icon: CalendarClock },
  done: { stripe: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
}

function Stat({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 basis-32 flex-col gap-0.5 rounded-xl border bg-card px-4 py-3 text-left transition hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring ${active ? 'border-primary ring-1 ring-primary' : ''}`}
    >
      <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  )
}

/** The part of a card where a student writes, attaches and hands in their work. */
function HandIn({ a, onChanged }: { a: Assignment; onChanged: () => void }) {
  const { t } = useT()
  const [text, setText] = useState(a.mySubmission?.text ?? '')
  const [busy, setBusy] = useState(false)
  const unchanged = !!a.mySubmission && text === (a.mySubmission.text ?? '')
  const submit = async () => {
    setBusy(true)
    try { await api(`/homework/${a.id}/submit`, { body: { text } }); toast.success(a.mySubmission ? t('Updated') : t('Handed in')); onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
      <label className="block space-y-1.5 text-sm font-medium">
        {t('Your answer')}
        <Textarea rows={4} placeholder={t('Type your answer here, or attach your work below.')} value={text} onChange={(e) => setText(e.target.value)} className="bg-background font-normal" />
      </label>
      <FileChips files={a.myFiles ?? []} canRemove onChanged={onChanged} />
      <div className="flex flex-wrap items-center gap-2">
        <AttachButton assignmentId={a.id} label={t('Attach a file')} onDone={onChanged} />
        <Button size="sm" className="gap-1.5" disabled={busy || !text.trim() || unchanged} onClick={submit}>
          <Send className="size-3.5" /> {a.mySubmission ? t('Update') : t('Hand in')}
        </Button>
      </div>
    </div>
  )
}

/** Who has handed in, for the teacher. */
function Submissions({ a }: { a: Assignment }) {
  const { t } = useT()
  const [rows, setRows] = useState<{ studentId: string; name: string; submittedAt: string | null; text?: string; files?: { id: string; name: string; size: number }[] }[] | null>(null)
  useEffect(() => { api<any[]>(`/homework/${a.id}/submissions`).then(setRows).catch((e) => toast.error(e.message)) }, [a.id])
  if (!rows) return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
  return (
    <ul className="divide-y rounded-lg border bg-background">
      {rows.map((s) => (
        <li key={s.studentId} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-sm">
          <span className="min-w-0 flex-1 basis-40 font-medium">{s.name}</span>
          {s.submittedAt
            ? <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">{t('Handed in')}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">{t('Missing')}</Badge>}
          {s.text && <p className="basis-full whitespace-pre-wrap text-muted-foreground">{s.text}</p>}
          <div className="basis-full"><FileChips files={s.files ?? []} /></div>
        </li>
      ))}
    </ul>
  )
}

function Card({ a, student, today, onChanged }: { a: Assignment; student: boolean; today: string; onChanged: () => void }) {
  const { t } = useT()
  const [writing, setWriting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [more, setMore] = useState(false)
  const tone = student ? toneOf(a, today) : a.dueDate < today ? 'overdue' : 'open'
  const { stripe, chip, Icon } = TONE[tone]
  const long = (a.description?.length ?? 0) > 180 || (a.description?.split('\n').length ?? 0) > 3
  const total = a.studentCount ?? 0
  const pct = total > 0 ? Math.round((a.submittedCount / total) * 100) : 0

  return (
    <article className="relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${stripe}`} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-4 pl-5">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 basis-40 text-base font-semibold leading-snug">{a.title}</h3>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${chip}`}>
            <Icon className="size-3.5" aria-hidden />
            {tone === 'done' ? t('Handed in') : dueLabel(a.dueDate, today, t)}
          </span>
        </header>

        {a.description && (
          <div>
            <p className={`whitespace-pre-wrap text-sm text-muted-foreground ${more ? '' : 'line-clamp-3'}`}>{a.description}</p>
            {long && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setMore((v) => !v)}>{more ? t('Show less') : t('Show more')}</button>}
          </div>
        )}
        <FileChips files={a.files ?? []} canRemove={a.canReview} onChanged={onChanged} />
        {a.canReview && <div className="flex flex-wrap items-center gap-2"><AttachButton assignmentId={a.id} label={t('Attach file')} onDone={onChanged} allowLink /></div>}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden />
          {t('Due {date}', { date: new Date(`${a.dueDate}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) })}
          {student && a.mySubmission && <> · {t('Handed in {value}', { value: new Date(a.mySubmission.submittedAt).toLocaleDateString() })}</>}
        </p>

        {student && (
          <div className="mt-auto space-y-3">
            {writing
              ? <HandIn a={a} onChanged={() => { onChanged() }} />
              : null}
            <Button size="sm" variant={a.mySubmission ? 'outline' : 'default'} className="gap-1.5" onClick={() => setWriting((v) => !v)} aria-expanded={writing}>
              {writing ? t('Close') : a.mySubmission ? t('See or change your work') : t('Start your work')}
              <ChevronDown className={`size-3.5 transition-transform ${writing ? 'rotate-180' : ''}`} aria-hidden />
            </Button>
          </div>
        )}

        {a.canReview && (
          <div className="mt-auto space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Users className="size-3.5" aria-hidden />{total > 0 ? t('{done} of {total} handed in', { done: a.submittedCount, total }) : t('{n} handed in', { n: a.submittedCount })}</span>
                {total > 0 && <span className="tabular-nums">{pct}%</span>}
              </div>
              {total > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} /></div>}
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReviewing((v) => !v)} aria-expanded={reviewing}>
              {reviewing ? t('Hide who handed in') : t('See who handed in')}
              <ChevronDown className={`size-3.5 transition-transform ${reviewing ? 'rotate-180' : ''}`} aria-hidden />
            </Button>
            {reviewing && <Submissions a={a} />}
          </div>
        )}
      </div>
    </article>
  )
}

/** The form a teacher uses to give out homework. */
function Composer({ classId, onDone }: { classId: string; onDone: () => void }) {
  const { t } = useT()
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [targets, setTargets] = useState<Set<string>>(new Set([classId]))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(todayStr())
  const [channels, setChannels] = useState<Channel[]>(['email', 'in_app'])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ id: string; name: string }[]>('/classes').then(setClasses).catch(() => undefined) }, [])
  const toggle = (id: string) => setTargets((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ results: { ok: boolean }[] }>('/homework', { body: { classIds: [...targets], title, description, dueDate, channels } })
      const ok = r.results.filter((x) => x.ok).length
      toast[ok === r.results.length ? 'success' : 'warning'](t('Assigned to {ok} of {total} class(es)', { ok, total: r.results.length }))
      setTitle(''); setDescription('')
      onDone()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={assign} className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-3">
          <Input placeholder={t('Title, for example “Fractions, exercise 4”')} aria-label={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          <Textarea rows={5} placeholder={t('Instructions for the class')} aria-label={t('Instructions')} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">{t('Due date')}<Input type="date" value={dueDate} min={todayStr()} onChange={(e) => setDueDate(e.target.value)} required /></label>
          {classes.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('Assign to classes')}</legend>
              <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto">
                {classes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm"><Checkbox checked={targets.has(c.id)} onCheckedChange={() => toggle(c.id)} /> {c.name}</label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>
      <ChannelPicker value={channels} onChange={setChannels} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || targets.size === 0 || !title.trim()}>{busy ? t('Assigning…') : t('Assign homework')}</Button>
      </div>
    </form>
  )
}

/** The class's homework: a summary on top, filters, then the work as cards. Students hand in; teachers assign and review. */
export function Homework({ classId }: { classId: string }) {
  const { t } = useT()
  const { user, can } = useAuth()
  const canAssign = can('homework', 'write')
  const isStudent = user?.role === 'student'
  const today = todayStr()
  const [rows, setRows] = useState<Assignment[] | null>(null)
  const [filter, setFilter] = useState<HomeworkFilter>('all')
  const [composing, setComposing] = useState(false)

  const load = useCallback(() => api<Assignment[]>(`/homework?classId=${classId}`).then(setRows).catch((e) => { toast.error(e.message); setRows([]) }), [classId])
  useEffect(() => { void load() }, [load])

  const sum = useMemo(() => summarize(rows ?? [], today), [rows, today])
  const shown = useMemo(() => {
    const list = rows ?? []
    if (!isStudent) return [...list].sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    return sortForStudent(list).filter((a) => matchesFilter(a, filter, today))
  }, [rows, isStudent, filter, today])

  if (!rows) return <p className="text-muted-foreground">{t('Loading…')}</p>

  return (
    <div className="space-y-5">
      {isStudent ? (
        <section aria-label={t('Your homework at a glance')} className="flex flex-wrap gap-3">
          <Stat label={t('All')} value={sum.total} tone="" active={filter === 'all'} onClick={() => setFilter('all')} />
          <Stat label={t('To do')} value={sum.todo} tone="text-primary" active={filter === 'todo'} onClick={() => setFilter('todo')} />
          <Stat label={t('Overdue')} value={sum.overdue} tone={sum.overdue ? 'text-destructive' : ''} active={filter === 'overdue'} onClick={() => setFilter('overdue')} />
          <Stat label={t('Handed in')} value={sum.done} tone="text-emerald-600 dark:text-emerald-400" active={filter === 'done'} onClick={() => setFilter('done')} />
        </section>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{rows.length === 0 ? t('Nothing assigned yet.') : t('{n} assignment(s) for this class', { n: rows.length })}</p>
          {canAssign && (
            <Button size="sm" className="gap-1.5" variant={composing ? 'outline' : 'default'} onClick={() => setComposing((v) => !v)} aria-expanded={composing}>
              <Plus className={`size-4 transition-transform ${composing ? 'rotate-45' : ''}`} aria-hidden />{composing ? t('Cancel') : t('New homework')}
            </Button>
          )}
        </div>
      )}

      {canAssign && composing && <Composer classId={classId} onDone={() => { setComposing(false); void load() }} />}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('No homework yet.')}</p>
          <p className="text-sm text-muted-foreground">{canAssign ? t('Use “New homework” to give the class its first assignment.') : t('New assignments from your teacher will appear here.')}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <PartyPopper className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filter === 'overdue' ? t('Nothing is overdue.') : filter === 'todo' ? t('You are all caught up.') : t('Nothing here yet.')}</p>
          <Button size="sm" variant="ghost" onClick={() => setFilter('all')}><BookOpen className="mr-1 size-4" />{t('Show all homework')}</Button>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {shown.map((a) => <Card key={a.id} a={a} student={!!isStudent} today={today} onChanged={() => void load()} />)}
        </div>
      )}
    </div>
  )
}
