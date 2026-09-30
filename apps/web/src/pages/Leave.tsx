import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useT } from '@/lib/i18n'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { useAuth } from '@/lib/auth'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Pager, usePaged } from '@/components/Pager'
import { LeavePanel } from '@/components/LeavePanel'

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
const variant = (s: string) => (s === 'rejected' ? 'destructive' : s === 'approved' ? 'default' : 'secondary')
const today = () => new Date().toISOString().slice(0, 10)
const range = (r: any) => (r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`)

export default function Leave() {
  const { t } = useT()
  const { user, can } = useAuth()
  const canRequest = can('leave', 'request')
  const canApprove = can('leave', 'approve')
  const isParent = user?.role === 'parent'
  const [rows, setRows] = useState<any[]>([])
  const pg_rows = usePaged(rows)
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [kids, setKids] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ studentId: '', fromDate: today(), toDate: today(), reason: '' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error?: string }[]>([])

  const load = useCallback(async () => {
    setRows(await api<any[]>(canApprove ? `/leave?status=${status}` : '/leave')); setSelected(new Set())
  }, [canApprove, status])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useLiveRefresh(['leave'], load)

  useEffect(() => {
    if (!isParent || !user?.linkedStudentIds?.length) return
    Promise.all(user.linkedStudentIds.map((id) => api<{ student: { id: string; name: string } }>(`/results/student/${id}`).then((r) => r.student).catch(() => ({ id, name: id }))))
      .then((k) => { setKids(k); setForm((f) => ({ ...f, studentId: f.studentId || k[0]?.id || '' })) })
  }, [isParent, user?.linkedStudentIds])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/leave', { body: { fromDate: form.fromDate, toDate: form.toDate, reason: form.reason, studentId: isParent ? form.studentId : undefined } })
      toast.success(t('Leave request sent')); setForm((f) => ({ ...f, reason: '' })); await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const pending = canApprove && status === 'pending'
  const allSel = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows, selected])
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { id: string; error?: string }[] }>('/leave/bulk-approve', { body: { ids: [...selected], decision: confirm, reason: reason || undefined } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} succeeded`)
      setFailed(r.failed); setConfirm(null); setReason(''); await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('Leave')}</h1>

      {canRequest && (
        <form onSubmit={submit} className="max-w-xl space-y-3">
          <h2 className="font-medium">{isParent ? 'Request leave for your child' : 'Request leave'}</h2>
          {isParent && <select className={selectCls} aria-label={t('Child')} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} required>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>}
          <div className="flex flex-wrap gap-2">
            <label className="text-sm">{t('From')} <Input type="date" min={today()} value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: e.target.value > form.toDate ? e.target.value : form.toDate })} required /></label>
            <label className="text-sm">{t('To')} <Input type="date" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} required /></label>
          </div>
          <Textarea placeholder={t('Reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={3} />
          <Button type="submit" disabled={isParent && !form.studentId}>{t('Send request')}</Button>
        </form>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{canApprove ? 'Leave requests' : 'Your requests'}</h2>
          {canApprove && <div className="flex gap-1">{(['pending', 'approved', 'rejected'] as const).map((s) => <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(s)}>{s}</Button>)}</div>}
        </div>
        {failed.length > 0 && <div className="rounded-md border border-destructive/50 p-3 text-sm"><p className="font-medium">{t('Not processed:')}</p><ul className="list-disc pl-5">{failed.map((f) => <li key={f.id}><code>{f.id.slice(-8)}</code>: {f.error}</li>)}</ul></div>}
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{canApprove ? `No ${status} leave requests.` : 'No leave requests yet.'}</p>
        ) : (
          <>
<Table>
            <TableHeader>
              <TableRow>
                {canApprove && <TableHead className="w-10">{pending && <Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={t('Select all')} />}</TableHead>}
                <TableHead>{t('For')}</TableHead><TableHead>{t('Dates')}</TableHead><TableHead>{t('Reason')}</TableHead><TableHead>{t('Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg_rows.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  {canApprove && <TableCell onClick={(e) => e.stopPropagation()}>{pending && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}</TableCell>}
                  <TableCell>{r.subjectName}<div className="text-xs capitalize text-muted-foreground">{r.subjectRole}{r.requesterId !== r.subjectUserId ? ` · asked by ${r.requesterName}` : ''}</div></TableCell>
                  <TableCell className="whitespace-nowrap">{range(r)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell><Badge variant={variant(r.status) as any} className="capitalize">{r.status}</Badge>{r.decisionNote && <div className="text-xs text-muted-foreground">{r.decisionNote}</div>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
<Pager {...pg_rows.props} />
</>
        )}
      </section>

      <LeavePanel
        leaveId={openId}
        onClose={() => setOpenId(null)}
        onDecide={(id, d) => { setSelected(new Set([id])); setConfirm(d); setOpenId(null) }}
      />

      {canApprove && (
        <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" onClick={() => setConfirm('approve')}>{t('Approve')}</Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirm('reject')}>{t('Reject')}</Button>
        </BulkSelectionBar>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? 'Approve' : 'Reject'} {selected.size} leave request(s)?</AlertDialogTitle>
            <AlertDialogDescription>{t('Requesters are notified.')} {confirm === 'reject' ? 'This reason is stored against every rejected request.' : ''}</AlertDialogDescription>
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
