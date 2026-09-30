import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { examVariant } from './Exams'
import { useT } from '@/lib/i18n'

const FILTERS = ['submitted', 'approved', 'rejected'] as const
interface BulkResult { total: number; succeeded: number; failed: { id: string; error?: string }[] }

export default function ResultApprovals() {
  const { t } = useT()
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('submitted')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api<any[]>(`/exams/queue?status=${status}`)); setSelected(new Set()) }
    catch (e) { toast.error((e as Error).message) } finally { setLoading(false) }
  }, [status])
  useEffect(() => { load() }, [load])
  useLiveRefresh(['results'], load)

  const pending = status === 'submitted'
  const allSelected = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows, selected])
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const view = async (id: string) => {
    if (open === id) return setOpen(null)
    setDetail((await api<{ marks: any[] }>(`/exams/${id}/marks`)).marks)
    setOpen(id)
  }

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await api<BulkResult>('/exams/bulk-approve', { body: { ids: [...selected], decision: confirm, reason: reason || undefined } })
      setResult(r)
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} succeeded`)
      setConfirm(null); setReason(''); await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('Result approvals')}</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => <Button key={f} size="sm" variant={f === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(f)}>{f === 'submitted' ? 'Pending' : f}</Button>)}
        </div>
      </div>

      {result && result.failed.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium">{t('{succeeded} of {total} succeeded. Not processed:', { succeeded: result.succeeded, total: result.total })}</p>
          <ul className="list-disc pl-5">{result.failed.map((f) => <li key={f.id}><code>{f.id.slice(-8)}</code>: {f.error}</li>)}</ul>
        </div>
      )}

      {loading ? <p className="text-muted-foreground">{t('Loading…')}</p> : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {pending ? t('No pending results. Teachers submit exam marks here for approval; students and parents see them once approved.') : t('No {status} results. Teachers submit exam marks here for approval; students and parents see them once approved.', { status: t(status) })}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">{pending && <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={t('Select all')} />}</TableHead>
              <TableHead>{t('Exam')}</TableHead><TableHead>{t('Class')}</TableHead><TableHead>{t('Teacher')}</TableHead><TableHead>{t('Marked')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <TableRow>
                  <TableCell>{pending && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}</TableCell>
                  <TableCell>{r.name} · {r.subject}<div className="text-xs text-muted-foreground">{t('{date} · out of {maxMarks}', { date: r.date, maxMarks: r.maxMarks })}</div></TableCell>
                  <TableCell>{r.className}</TableCell>
                  <TableCell>{r.teacherName}</TableCell>
                  <TableCell>{r.markedCount}</TableCell>
                  <TableCell><Badge variant={examVariant(r.status)} className="capitalize">{r.status}</Badge>{r.reason && <div className="text-xs text-muted-foreground">{r.reason}</div>}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => view(r.id)}>{open === r.id ? 'Hide' : 'View marks'}</Button></TableCell>
                </TableRow>
                {open === r.id && (
                  <TableRow>
                    <TableCell />
                    <TableCell colSpan={6}>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        {detail.map((m) => <span key={m.studentId}>{m.name}: <b>{m.absent ? 'Absent' : m.score ?? '—'}</b></span>)}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => setConfirm('approve')}>{t('Approve')}</Button>
        <Button size="sm" variant="destructive" onClick={() => setConfirm('reject')}>{t('Send back')}</Button>
      </BulkSelectionBar>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? 'Approve' : 'Send back'} {selected.size} exam result(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'approve' ? 'Students and their parents are notified and can see the results immediately.' : 'Teachers can edit and resubmit. This reason is stored against every exam.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder={confirm === 'reject' ? 'Reason (required)' : 'Note (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || (confirm === 'reject' && !reason.trim())} onClick={(e) => { e.preventDefault(); run() }}>{busy ? 'Working…' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
