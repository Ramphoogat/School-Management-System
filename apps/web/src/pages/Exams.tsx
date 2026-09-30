import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/lib/i18n'

export const examVariant = (s: string) => (s === 'rejected' ? 'destructive' : s === 'approved' ? 'default' : 'secondary')
const todayStr = () => new Date().toISOString().slice(0, 10)

interface Row { studentId: string; name: string; email: string; score: number | null; absent: boolean }
interface MarksData { exam: any; canEdit: boolean; marks: Row[] }

/** Minimal CSV reader: header row with email and score columns; "AB"/"absent" marks a student absent. */
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('The file needs a header row and at least one student')
  const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const head = split(lines[0]).map((h) => h.toLowerCase())
  const ei = head.indexOf('email'), si = head.indexOf('score')
  if (ei < 0 || si < 0) throw new Error('Header must contain "email" and "score" columns')
  return lines.slice(1).map((l) => {
    const c = split(l)
    const raw = c[si] ?? ''
    const absent = /^(ab|absent)$/i.test(raw)
    return { email: c[ei], absent, score: absent || raw === '' ? null : Number(raw) }
  })
}

function MarksGrid({ examId, onChanged }: { examId: string; onChanged: () => void }) {
  const { t } = useT()
  const [data, setData] = useState<MarksData | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const d = await api<MarksData>(`/exams/${examId}/marks`)
    setData(d); setRows(d.marks)
  }, [examId])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  if (!data) return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
  const { exam, canEdit } = data
  const set = (id: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.studentId === id ? { ...x, ...patch } : x)))
  const invalid = (r: Row) => !r.absent && r.score !== null && (r.score < 0 || r.score > exam.maxMarks)
  const anyInvalid = rows.some(invalid)

  const save = async (): Promise<boolean> => {
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { key: string; error: string }[] }>(`/exams/${examId}/marks`, {
        method: 'PUT', body: { marks: rows.map((x) => ({ studentId: x.studentId, score: x.absent ? null : x.score, absent: x.absent })) },
      })
      toast[r.failed.length ? 'warning' : 'success'](`Marks saved: ${r.succeeded} of ${r.total}`)
      await load(); onChanged()
      return r.failed.length === 0
    } catch (e) { toast.error((e as Error).message); return false } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!(await save())) return
    try { await api(`/exams/${examId}/submit`, { method: 'POST', body: {} }); toast.success(t('Submitted for approval')); await load(); onChanged() }
    catch (e) { toast.error((e as Error).message) }
  }

  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const parsed = parseCsv(await f.text())
      const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r.studentId]))
      let matched = 0
      const unknown: string[] = []
      const next = [...rows]
      for (const p of parsed) {
        const id = byEmail.get(p.email?.toLowerCase())
        if (!id) { unknown.push(p.email); continue }
        const i = next.findIndex((r) => r.studentId === id)
        next[i] = { ...next[i], score: p.absent ? null : Number.isFinite(p.score) ? p.score : null, absent: p.absent }
        matched++
      }
      setRows(next)
      toast[unknown.length ? 'warning' : 'success'](`Imported ${matched} row(s). Review, then Save.${unknown.length ? ` Not in class: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}` : ''}`)
    } catch (err) { toast.error((err as Error).message) }
  }

  return (
    <div className="space-y-3">
      {exam.status === 'rejected' && exam.reason && <p className="rounded-md border border-destructive/50 p-2 text-sm">{t('Sent back by the principal: {reason}', { reason: exam.reason })}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}>{t('Import CSV')}</Button>
          <Button size="sm" variant="ghost" onClick={() => downloadCsv(`marks-${exam.subject}-template`, ['email', 'score'], rows.map((r) => [r.email, r.absent ? 'AB' : r.score ?? '']))}>{t('Download template')}</Button>
          <span className="self-center text-xs text-muted-foreground">{t('Columns: email, score (use AB for absent)')}</span>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>{t('Student')}</TableHead><TableHead>{t('Score / {maxMarks}', { maxMarks: exam.maxMarks })}</TableHead>{canEdit && <TableHead>{t('Absent')}</TableHead>}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.studentId}>
              <TableCell>{r.name}</TableCell>
              <TableCell>
                {canEdit ? (
                  <Input type="number" min={0} max={exam.maxMarks} step="0.5" className={`w-28 ${invalid(r) ? 'border-destructive' : ''}`} disabled={r.absent} value={r.score ?? ''} onChange={(e) => set(r.studentId, { score: e.target.value === '' ? null : Number(e.target.value) })} aria-label={`Score for ${r.name}`} />
                ) : r.absent ? 'Absent' : r.score ?? '—'}
              </TableCell>
              {canEdit && <TableCell><Checkbox checked={r.absent} onCheckedChange={(v) => set(r.studentId, { absent: !!v })} aria-label={`Absent: ${r.name}`} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={busy || anyInvalid}>{t('Save draft')}</Button>
          <Button onClick={submit} disabled={busy || anyInvalid}>{t('Save and submit for approval')}</Button>
        </div>
      )}
      {anyInvalid && <p className="text-xs text-destructive">{t('A score is outside 0 to {maxMarks}.', { maxMarks: exam.maxMarks })}</p>}
    </div>
  )
}

export function Grades({ classId }: { classId: string }) {
  const { t } = useT()
  const { can } = useAuth()
  const canCreate = can('results', 'write')
  const [exams, setExams] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [maxMarks, setMax] = useState('100')
  const [date, setDate] = useState(todayStr())
  const [deleting, setDeleting] = useState<any | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<any[]>(`/exams?classId=${classId}`).then(setExams), [classId])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const ex = await api<{ id: string }>('/exams', { body: { classId, name, subject, maxMarks: Number(maxMarks), date } })
      toast.success(t('Exam created. Enter the marks below.'))
      setName(''); setSubject('')
      await load(); setOpen(ex.id)
    } catch (err) { toast.error((err as Error).message) }
  }

  // A draft or rejected exam has published nothing, so it goes at once. A submitted or published one needs a reason.
  const published = deleting && !['draft', 'rejected'].includes(deleting.status)
  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await api(`/exams/${deleting.id}${published ? `?reason=${encodeURIComponent(reason)}` : ''}`, { method: 'DELETE' })
      toast.success(t('Exam deleted'))
      setDeleting(null); setReason(''); if (open === deleting.id) setOpen(null)
      await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      {canCreate && (
        <form onSubmit={create} className="flex max-w-3xl flex-wrap items-end gap-2">
          <Input className="w-44" placeholder={t('Exam name (e.g. Unit Test 1)')} value={name} onChange={(e) => setName(e.target.value)} required />
          <Input className="w-36" placeholder={t('Subject')} value={subject} onChange={(e) => setSubject(e.target.value)} required />
          <Input className="w-24" type="number" min={1} value={maxMarks} onChange={(e) => setMax(e.target.value)} aria-label={t('Maximum marks')} required />
          <Input className="w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Button type="submit">{t('Create exam')}</Button>
        </form>
      )}
      {exams.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {canCreate ? 'No exams yet. Create one above, enter marks, then submit for the principal to approve.' : 'Results appear here once the principal has approved them.'}
        </p>
      ) : (
        exams.map((e) => (
          <article key={e.id} className="max-w-3xl space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-medium">{e.name} · {e.subject}</h3>
                <p className="text-xs text-muted-foreground">{e.date} · out of {e.maxMarks}{canCreate ? ` · ${e.markedCount} marked` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {canCreate && <Badge variant={examVariant(e.status)} className="capitalize">{e.status}</Badge>}
                <Button size="sm" variant="outline" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Close' : canCreate ? 'Marks' : 'View'}</Button>
                {e.canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setDeleting(e); setReason('') }}>{t('Delete')}</Button>}
              </div>
            </div>
            {open === e.id && <MarksGrid examId={e.id} onChanged={load} />}
          </article>
        ))
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete {name}?', { name: deleting?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {published
                ? `This exam is ${deleting?.status}. Deleting it removes its ${deleting?.markedCount ?? 0} mark(s)${deleting?.status === 'approved' ? ', and students and parents will no longer see these results' : ''}. This cannot be undone, and the reason is recorded.`
                : `This removes the exam and its ${deleting?.markedCount ?? 0} mark(s). Nothing has been published from it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {published && <Textarea placeholder={t('Reason (required)')} value={reason} onChange={(e) => setReason(e.target.value)} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || (!!published && reason.trim().length < 3)} onClick={(e) => { e.preventDefault(); void remove() }}>{busy ? 'Deleting…' : 'Delete exam'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
