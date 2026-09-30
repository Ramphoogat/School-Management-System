import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useParams, useSearchParams } from 'react-router'
import { Users } from 'lucide-react'
import { channelIcon } from '@/lib/channelIcons'
import { toast } from 'sonner'
import { api, tokens } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { downloadCsv } from '@/lib/csv'
import { useAuth } from '@/lib/auth'
import { usePresence } from '@/lib/presence'
import { useLiveRefresh } from '@/lib/live'
import { MembersPanel, type Member } from '@/components/MembersPanel'
import { AttendanceCalendar } from '@/components/AttendanceCalendar'
import { Grades } from '@/pages/Exams'
import { Voice } from '@/pages/Voice'
import { ChannelPicker, type Channel } from '@/components/ChannelPicker'
import { Resources } from '@/components/Resources'
import { AttachButton, FileChips } from '@/components/HomeworkFiles'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Status = 'present' | 'absent' | 'late' | 'leave'
const STATUS_LABEL: Record<Status, string> = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'On leave' }
const todayStr = () => new Date().toISOString().slice(0, 10)

function Announcements({ classId }: { classId: string }) {
  const { t } = useT()
  const { can } = useAuth()
  const canPost = can('announcements', 'write') || can('announcements', 'manage')
  const [rows, setRows] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [channels, setChannels] = useState<Channel[]>(['email', 'in_app'])

  const load = useCallback(() => api<any[]>(`/announcements?classId=${classId}`).then(setRows), [classId])
  useEffect(() => { load() }, [load])
  useLiveRefresh(['announcements'], load)
  const [editing, setEditing] = useState<{ id: string; title: string; body: string; urgent: boolean } | null>(null)

  const saveEdit = async () => {
    if (!editing) return
    try {
      await api(`/announcements/${editing.id}`, { method: 'PUT', body: { title: editing.title, body: editing.body, urgent: editing.urgent } })
      toast.success(t('Announcement updated'))
      setEditing(null); await load()
    } catch (err) { toast.error((err as Error).message) }
  }
  const remove = async (a: any) => {
    if (!window.confirm(`Delete "${a.title}"? It is removed for everyone. Messages already sent stay in inboxes.`)) return
    try { await api(`/announcements/${a.id}`, { method: 'DELETE' }); toast.success(t('Announcement deleted')); await load() }
    catch (err) { toast.error((err as Error).message) }
  }

  const post = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/announcements', { body: { classId, title, body, urgent, channels } })
      toast.success(t('Announcement posted'))
      setTitle(''); setBody(''); setUrgent(false)
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      {canPost && (
        <form onSubmit={post} className="max-w-xl space-y-3">
          <Input placeholder={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea placeholder={t('Write an announcement…')} value={body} onChange={(e) => setBody(e.target.value)} required />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={urgent} onCheckedChange={(v) => setUrgent(!!v)} /> {t('Mark as urgent')}</label>
          <ChannelPicker value={channels} onChange={setChannels} />
          <Button type="submit">{t('Post')}</Button>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('No announcements yet.')}{canPost ? ' Post the first one above.' : ' Your teachers will post updates here.'}
        </p>
      ) : (
        rows.map((a) => (
          <article key={a.id} className="max-w-xl rounded-lg border p-4">
            {editing && editing.id === a.id ? (
              <div className="space-y-2">
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label={t('Title')} />
                <Textarea rows={4} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label={t('Message')} />
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={editing.urgent} onCheckedChange={(v) => setEditing({ ...editing, urgent: !!v })} /> {t('Mark as urgent')}</label>
                <p className="text-xs text-muted-foreground">{t('People are not sent this again. It shows as edited.')}</p>
                <div className="flex gap-2"><Button size="sm" onClick={saveEdit} disabled={!editing.title.trim() || !editing.body.trim()}>{t('Save')}</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}>{t('Cancel')}</Button></div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{a.title}</h3>
                  {a.urgent && <Badge variant="destructive">{t('Urgent')}</Badge>}
                  {a.canModify && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: a.id, title: a.title, body: a.body, urgent: a.urgent })}>{t('Edit')}</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(a)}>{t('Delete')}</Button>
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">{a.authorName} · {new Date(a.createdAt).toLocaleString()}{a.editedAt ? ' · edited' : ''}</p>
              </>
            )}
          </article>
        ))
      )}
    </div>
  )
}

/** Parents pick from their linked children; the names come from each child's summary. */
function ParentCalendar({ childIds }: { childIds: string[] }) {
  const { t } = useT()
  const [kids, setKids] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    Promise.all(childIds.map((id) => api<{ student: { id: string; name: string } }>(`/attendance/student/${id}`).then((r) => r.student).catch(() => null)))
      .then((k) => setKids(k.filter(Boolean) as { id: string; name: string }[]))
  }, [childIds])
  if (kids === null) return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
  if (kids.length === 0) return <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No linked children yet.')}</p>
  return <AttendanceCalendar students={kids} />
}

/** Students and parents see a calendar of school days; teachers and staff mark and review the class roster. */
function Attendance({ classId }: { classId: string }) {
  const { user } = useAuth()
  if (user?.role === 'student') return <AttendanceCalendar students={[{ id: user.id, name: user.name }]} />
  if (user?.role === 'parent') return <ParentCalendar childIds={user.linkedStudentIds ?? []} />
  return <AttendanceRoster classId={classId} />
}

function AttendanceRoster({ classId }: { classId: string }) {
  const { can } = useAuth()
  const { t } = useT()
  const canMark = can('attendance', 'bulk_write')
  const [date, setDate] = useState(todayStr())
  const [students, setStudents] = useState<{ id: string; name: string; status: Status | null; onLeave: boolean; leaveReason: string | null }[]>([])
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<{ students: typeof students }>(`/attendance/class/${classId}?date=${date}`)
    setStudents(r.students)
    setMarks(Object.fromEntries(r.students.map((s) => [s.id, s.status ?? (s.onLeave ? 'leave' : 'present')])))
    setSelected(new Set())
  }, [classId, date])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  const counts = useMemo(() => {
    const c: Record<Status, number> = { present: 0, absent: 0, late: 0, leave: 0 }
    Object.values(marks).forEach((s) => c[s]++)
    return c
  }, [marks])

  const setFor = (ids: string[], s: Status) => setMarks((m) => ({ ...m, ...Object.fromEntries(ids.map((i) => [i, s])) }))
  const allSel = students.length > 0 && selected.size === students.length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: unknown[] }>(`/attendance/class/${classId}/bulk`, {
        body: { date, records: students.map((s) => ({ studentId: s.id, status: marks[s.id] })) },
      })
      toast[r.failed.length ? 'warning' : 'success'](`Attendance saved: ${r.succeeded} of ${r.total}`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" aria-label={t('Date')} value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="w-44" />
        <span className="text-sm text-muted-foreground">
          {counts.present} present · {counts.absent} absent · {counts.late} late{counts.leave > 0 && ` · ${counts.leave} on leave`}
        </span>
        <Button variant="outline" size="sm" className={canMark ? "ml-auto" : "ml-auto"} disabled={students.length === 0} onClick={() => downloadCsv(`attendance-${date}`, ["Student", "Date", "Status"], students.map((s) => [s.name, date, marks[s.id] ?? s.status ?? "not marked"]))}>{t('Export CSV')}</Button>
        {canMark && (
          <Button onClick={save} disabled={busy || students.length === 0}>
            {busy ? 'Saving…' : 'Save attendance'}
          </Button>
        )}
      </div>
      {students.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No students are enrolled in this class yet.')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {canMark && <TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(students.map((s) => s.id)))} aria-label={t('Select all')} /></TableHead>}
              <TableHead>{t('Student')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((s) => (
              <TableRow key={s.id}>
                {canMark && <TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} /></TableCell>}
                <TableCell>
                  {s.name}{s.status === null && <span className="ml-2 text-xs text-muted-foreground">{t('not yet saved')}</span>}
                  {s.onLeave && <div className="text-xs text-muted-foreground" title={s.leaveReason ?? ''}>{t('Approved leave today')}{s.status === 'absent' ? ' (marked absent anyway)' : ''}</div>}
                </TableCell>
                <TableCell>
                  {canMark ? (
                    <div className="flex gap-1">
                      {(['present', 'absent', 'late', ...(s.onLeave || marks[s.id] === 'leave' ? ['leave'] : [])] as Status[]).map((st) => (
                        <Button key={st} size="sm" variant={marks[s.id] === st ? (st === 'absent' ? 'destructive' : 'default') : 'outline'} onClick={() => setFor([s.id], st)}>
                          {STATUS_LABEL[st]}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Badge variant={s.status === 'absent' ? 'destructive' : 'secondary'}>{s.status ? STATUS_LABEL[s.status] : s.onLeave ? 'On leave' : 'Not marked'}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canMark && (
        <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" onClick={() => setFor([...selected], 'present')}>{t('Mark present')}</Button>
          <Button size="sm" variant="destructive" onClick={() => setFor([...selected], 'absent')}>{t('Mark absent')}</Button>
          <Button size="sm" variant="outline" onClick={() => setFor([...selected], 'late')}>{t('Mark late')}</Button>
        </BulkSelectionBar>
      )}
    </div>
  )
}

function Homework({ classId }: { classId: string }) {
  const { t } = useT()
  const { user, can } = useAuth()
  const canAssign = can('homework', 'write')
  const isStudent = user?.role === 'student'
  const [rows, setRows] = useState<any[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [targets, setTargets] = useState<Set<string>>(new Set([classId]))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(todayStr())
  const [channels, setChannels] = useState<Channel[]>(['email', 'in_app'])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [subs, setSubs] = useState<any[]>([])

  const load = useCallback(() => api<any[]>(`/homework?classId=${classId}`).then(setRows), [classId])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useEffect(() => {
    if (canAssign) api<{ id: string; name: string }[]>('/classes').then(setClasses)
  }, [canAssign])

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await api<{ results: { ok: boolean }[] }>('/homework', { body: { classIds: [...targets], title, description, dueDate, channels } })
      const ok = r.results.filter((x) => x.ok).length
      toast[ok === r.results.length ? 'success' : 'warning'](`Assigned to ${ok} of ${r.results.length} class(es)`)
      setTitle(''); setDescription('')
      await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const submit = async (id: string) => {
    try {
      await api(`/homework/${id}/submit`, { body: { text: answers[id] } })
      toast.success(t('Submitted'))
      await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const review = async (id: string) => {
    if (open === id) return setOpen(null)
    setSubs(await api<any[]>(`/homework/${id}/submissions`))
    setOpen(id)
  }

  const toggleTarget = (id: string) => setTargets((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="space-y-6">
      {canAssign && (
        <form onSubmit={assign} className="max-w-xl space-y-3">
          <Input placeholder={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea placeholder={t('Instructions')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Input type="date" aria-label={t('Due date')} value={dueDate} min={todayStr()} onChange={(e) => setDueDate(e.target.value)} className="w-44" required />
          {classes.length > 1 && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('Assign to classes')}</legend>
              <div className="flex flex-wrap gap-4">
                {classes.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={targets.has(c.id)} onCheckedChange={() => toggleTarget(c.id)} /> {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <ChannelPicker value={channels} onChange={setChannels} />
          <Button type="submit" disabled={targets.size === 0}>{t('Assign homework')}</Button>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('No homework yet.')}{canAssign ? ' Assign the first one above.' : ' New assignments appear here.'}
        </p>
      ) : (
        rows.map((a) => (
          <article key={a.id} className="max-w-xl space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">{a.title}</h3>
              <Badge variant={a.dueDate < todayStr() ? 'destructive' : 'secondary'}>{t('Due {dueDate}', { dueDate: a.dueDate })}</Badge>
            </div>
            {a.description && <p className="whitespace-pre-wrap text-sm">{a.description}</p>}
            <FileChips files={a.files ?? []} canRemove={a.canReview} onChanged={load} />
            {a.canReview && canAssign && <AttachButton assignmentId={a.id} label="Attach file" onDone={load} />}
            {isStudent && (
              <div className="space-y-2">
                {a.mySubmission && <Badge>{t('Submitted {value}', { value: new Date(a.mySubmission.submittedAt).toLocaleDateString() })}</Badge>}
                <FileChips files={a.myFiles ?? []} canRemove onChanged={load} />
                <AttachButton assignmentId={a.id} label="Upload your work" onDone={load} />
                <Textarea placeholder={t('Your answer')} defaultValue={a.mySubmission?.text ?? ''} onChange={(e) => setAnswers((x) => ({ ...x, [a.id]: e.target.value }))} />
                <Button size="sm" disabled={!answers[a.id]?.trim()} onClick={() => submit(a.id)}>{a.mySubmission ? 'Resubmit' : 'Submit'}</Button>
              </div>
            )}
            {a.canReview && (
              <div>
                <Button size="sm" variant="outline" onClick={() => review(a.id)}>{a.submittedCount} submitted · {open === a.id ? 'Hide' : 'View'}</Button>
                {open === a.id && (
                  <Table className="mt-2">
                    <TableHeader><TableRow><TableHead>{t('Student')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead>{t('Files')}</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {subs.map((s) => (
                        <TableRow key={s.studentId}>
                          <TableCell>{s.name}</TableCell>
                          <TableCell>{s.submittedAt ? <span title={s.text}>{t('Submitted')}</span> : <span className="text-muted-foreground">{t('Missing')}</span>}</TableCell>
                          <TableCell><FileChips files={s.files ?? []} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </article>
        ))
      )}
    </div>
  )
}

function Chat({ classId, channelId, members }: { classId: string; channelId?: string; members: Member[] | null }) {
  const { t } = useT()
  const { user } = useAuth()
  const { isOnline } = usePresence()
  const [msgs, setMsgs] = useState<any[]>([])
  const [text, setText] = useState('')
  const [live, setLive] = useState(false)
  const sock = useRef<Socket | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    api<any[]>(`/chat/${classId}${channelId ? `?channelId=${channelId}` : ''}`).then((h) => { if (!cancelled) setMsgs(h) }).catch((e) => toast.error(e.message))
    const s = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', { auth: { token: tokens.access } })
    sock.current = s
    s.on('connect', () => { setLive(true); s.emit('join', { classId }) }) // re-join after reconnects
    s.on('disconnect', () => setLive(false))
    s.on('message', (m) => { if (m.classId === classId && (m.channelId ?? null) === (channelId ?? null)) setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m])) })
    return () => { cancelled = true; s.emit('leave', { classId }); s.close() }
  }, [classId, channelId])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  const send = (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || !sock.current) return
    sock.current.emit('message', { classId, body, channelId }, (r: { ok: boolean }) => { if (!r?.ok) toast.error(t('Message not sent')) })
    setText('')
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-96 w-full flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-2 text-xs text-muted-foreground">{live ? 'Connected' : 'Connecting…'}{members && ` · ${members.filter((m) => isOnline(m.id)).length} of ${members.length} members online`}</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && <p className="text-center text-sm text-muted-foreground">{t('No messages yet. Say hello to your class.')}</p>}
        {msgs.map((m) => {
          const mine = m.senderId === user?.id
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-muted-foreground">{mine ? 'You' : m.senderName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{m.body}</p>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t p-3">
        <Input placeholder={t('Message the class…')} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim() || !live}>{t('Send')}</Button>
      </form>
    </div>
  )
}

export function ClassPage() {
  const { t } = useT()
  const { id = '' } = useParams()
  const [sp] = useSearchParams()
  const channel = sp.get('channel') ?? 'announcements'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const { user: me } = useAuth()
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [channels, setChannels] = useState<{ id: string; type: string; name: string; icon?: string | null }[]>([])
  const cid = sp.get('cid') ?? ''
  useEffect(() => {
    const load = () => api<{ id: string; monitorId: string | null; channels: { id: string; type: string; name: string; icon?: string | null }[] }[]>('/classes')
      .then((cs) => { const c = cs.find((x) => x.id === id); setMonitorId(c?.monitorId ?? null); setChannels(c?.channels ?? []) }).catch(() => undefined)
    load()
    window.addEventListener('classes-changed', load)
    return () => window.removeEventListener('classes-changed', load)
  }, [id])
  const custom = channel === 'text' ? channels.find((c) => c.id === cid) : undefined
  const HeadIcon = channelIcon(channel, custom?.icon)
  // Only a teacher of this class is offered the picker; the API enforces the same rule.
  const pickMonitor = me?.role === 'teacher' && members?.some((m) => m.id === me.id)
    ? async (studentId: string | null) => {
        try { await api(`/classes/${id}/monitor`, { method: 'PUT', body: { studentId } }); setMonitorId(studentId); toast.success(studentId ? 'Class monitor set' : 'Class monitor cleared') }
        catch (e) { toast.error((e as Error).message) }
      }
    : undefined
  useEffect(() => {
    setMembers(null)
    api<Member[]>(`/chat/${id}/members`).then(setMembers).catch(() => setMembers([]))
  }, [id])
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-6">
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold capitalize"><HeadIcon className="h-6 w-6 opacity-70" />{channel === 'text' ? (custom?.name ?? 'channel') : channel}</h1>
        <Button variant="outline" size="sm" className="gap-1.5 xl:hidden" onClick={() => setShowMembers((v) => !v)}>
          <Users className="h-4 w-4" /> {t('Members')}{members ? ` (${members.length})` : ''}
        </Button>
      </div>
      {showMembers && <div className="rounded-xl border bg-card p-2 xl:hidden"><MembersPanel members={members} monitorId={monitorId} onPickMonitor={pickMonitor} /></div>}
      {channel === 'text' ? (
        custom ? <Chat key={`${id}-${cid}`} classId={id} channelId={cid} members={members} /> : <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('This channel no longer exists.')}</div>
      ) : channel === 'announcements' ? (
        <Announcements key={id} classId={id} />
      ) : channel === 'grades' ? (
        <Grades key={id} classId={id} />
      ) : channel === 'voice' ? (
        <Voice key={id} classId={id} />
      ) : channel === 'chat' ? (
        <Chat key={id} classId={id} members={members} />
      ) : channel === 'homework' ? (
        <Homework key={id} classId={id} />
      ) : channel === 'resources' ? (
        <Resources key={id} classId={id} />
      ) : channel === 'attendance' ? (
        <Attendance key={id} classId={id} />
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('The {channel} feature is built in a later phase. This channel is where it will live.', { channel })}</div>
      )}
    </div>
    <aside className="hidden xl:block">
      <div className="sticky top-0 rounded-xl border bg-card p-2">
        <MembersPanel members={members} monitorId={monitorId} onPickMonitor={pickMonitor} />
      </div>
    </aside>
    </div>
  )
}
