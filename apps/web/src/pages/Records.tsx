import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n'
import { Link, useParams, useSearchParams } from 'react-router'
import { downloadCsv, stamp } from '@/lib/csv'
import { toast } from 'sonner'
import { api, apiList, downloadFile } from '@/lib/api'
import { CutOffNotice } from '@/components/CutOffNotice'
import { useLiveRefresh } from '@/lib/live'
import { useAuth } from '@/lib/auth'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { inr } from './Fees'
import { splitPhone } from '@/lib/phone'
import { Pager, usePaged } from '@/components/Pager'

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
const TYPE_LABEL: Record<string, string> = { bonafide: 'Bonafide certificate', transfer: 'Transfer certificate', character: 'Character certificate' }

export function Students() {
  const { t: tr } = useT()
  const [sp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const pg_rows = usePaged(rows)
  useEffect(() => {
    const t = setTimeout(() => apiList<any>(`/students?q=${encodeURIComponent(q)}`).then((r) => { setRows(r.rows); setTotal(r.total) }).catch((e) => toast.error(e.message)), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tr('Students')}</h1>
        <p className="text-sm text-muted-foreground">{total} student{total === 1 ? '' : 's'}{q ? ` matching “${q}”` : ''}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input className="sm:max-w-sm" placeholder={tr('Search by name or email')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" size="sm" className="self-start sm:self-auto" disabled={rows.length === 0} onClick={() => downloadCsv(`students-${stamp()}`, ['Name', 'Email', 'Class', 'Parents', 'Country code', 'Phone number'], rows.map((s) => [s.name, s.email, s.classes.map((c: any) => c.name).join('; '), s.parents.map((p: any) => p.name).join('; '), s.parents.map((p: any) => splitPhone(p.phone).code).join('; '), s.parents.map((p: any) => splitPhone(p.phone).number).join('; ')]))}>{tr('Export CSV')}</Button>
      </div>
      {rows.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{tr('No students found.')}</p> : (
        <>
<Table>
          <TableHeader><TableRow><TableHead>{tr('Student')}</TableHead><TableHead>{tr('Class')}</TableHead><TableHead>{tr('Parents')}</TableHead><TableHead>{tr('Country code')}</TableHead><TableHead>{tr('Phone number')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {pg_rows.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.name}<div className="text-xs text-muted-foreground">{s.email}</div></TableCell>
                <TableCell>{s.classes.map((c: any) => c.name).join(', ') || '—'}</TableCell>
                <TableCell>{s.parents.length === 0 ? <span className="text-xs text-muted-foreground">{tr('No approved parent link')}</span> : s.parents.map((p: any) => <div key={p.email} className="text-sm">{p.name} <span className="text-xs text-muted-foreground">({p.relationship})</span></div>)}</TableCell>
                <TableCell>{s.parents.length === 0 ? '—' : s.parents.map((p: any) => <div key={p.email} className="text-sm">{splitPhone(p.phone).code || '—'}</div>)}</TableCell>
                <TableCell className="tabular-nums">{s.parents.length === 0 ? '—' : s.parents.map((p: any) => <div key={p.email} className="text-sm">{splitPhone(p.phone).number || '—'}</div>)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
<CutOffNotice shown={rows.length} total={total} />
<Pager {...pg_rows.props} />
</>
      )}
    </div>
  )
}

export function Waivers() {
  const { t } = useT()
  const [status, setStatus] = useState<'requested' | 'approved' | 'rejected'>('requested')
  const [rows, setRows] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ id: string; error?: string }[]>([])

  const load = useCallback(async () => { setRows(await api<any[]>(`/fees/waivers?status=${status}`)); setSelected(new Set()) }, [status])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useLiveRefresh(['waivers'], load)
  const pending = status === 'requested'
  const allSel = rows.length > 0 && selected.size === rows.length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const sum = useMemo(() => rows.filter((r) => selected.has(r.id)).reduce((a, r) => a + r.amount, 0), [rows, selected])

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { id: string; error?: string }[] }>('/fees/waivers/bulk-approve', { body: { ids: [...selected], decision: confirm, reason } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} succeeded`)
      setFailed(r.failed); setConfirm(null); setReason(''); await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('Fee waivers')}</h1>
        <div className="flex gap-1">{(['requested', 'approved', 'rejected'] as const).map((s) => <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(s)}>{s === 'requested' ? 'Pending' : s}</Button>)}</div>
      </div>
      {failed.length > 0 && <div className="rounded-md border border-destructive/50 p-3 text-sm"><p className="font-medium">{t('Not processed:')}</p><ul className="list-disc pl-5">{failed.map((f) => <li key={f.id}><code>{f.id.slice(-8)}</code>: {f.error}</li>)}</ul></div>}
      {rows.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{pending ? t('No pending waivers. Clerks request waivers from the Fees page.') : t('No {status} waivers. Clerks request waivers from the Fees page.', { status: t(status) })}</p> : (
        <Table>
          <TableHeader><TableRow><TableHead className="w-10">{pending && <Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={t('Select all')} />}</TableHead><TableHead>{t('Student')}</TableHead><TableHead>{t('Fee')}</TableHead><TableHead>{t('Amount')}</TableHead><TableHead>{t('Reason')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{pending && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}</TableCell>
                <TableCell>{r.studentName}<div className="text-xs text-muted-foreground">{r.className}</div></TableCell>
                <TableCell>{r.title}</TableCell><TableCell>{inr(r.amount)}</TableCell>
                <TableCell>{r.waiverReason}{r.waiverNote && <div className="text-xs text-muted-foreground">{t('Decision: {waiverNote}', { waiverNote: r.waiverNote })}</div>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => setConfirm('approve')}>{t('Approve waiver')}</Button>
        <Button size="sm" variant="destructive" onClick={() => setConfirm('reject')}>{t('Decline')}</Button>
      </BulkSelectionBar>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? 'Waive' : 'Decline waiver for'} {selected.size} invoice(s)?</AlertDialogTitle>
            <AlertDialogDescription>{confirm === 'approve' ? `This forgives ${inr(sum)} in total.` : 'The invoices stay payable.'} {t('The note below is stored against every invoice.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder={t('Note (required)')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || reason.trim().length < 3} onClick={(e) => { e.preventDefault(); run() }}>{busy ? 'Working…' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function Certificates() {
  const { t } = useT()
  const { can } = useAuth()
  const canIssue = can('certificates', 'bulk_write')
  const [certs, setCerts] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [type, setType] = useState('bonafide')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ studentId: string; error?: string }[]>([])

  const load = useCallback(() => api<any[]>('/certificates').then(setCerts), [])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useEffect(() => { if (canIssue) api<any[]>('/students').then(setStudents).catch(() => undefined) }, [canIssue])

  const allSel = students.length > 0 && selected.size === students.length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const issue = async () => {
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { studentId: string; error?: string }[] }>('/certificates/bulk-issue', { body: { studentIds: [...selected], type } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} certificate(s) issued`)
      setFailed(r.failed); setSelected(new Set()); await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('Certificates')}</h1>
      {canIssue && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{t('Issue certificates')}</h2>
            <select className={selectCls} aria-label={t('Certificate type')} value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          {students.length === 0 ? <p className="text-sm text-muted-foreground">{t('No students yet.')}</p> : (
            <Table>
              <TableHeader><TableRow><TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(students.map((s) => s.id)))} aria-label={t('Select all')} /></TableHead><TableHead>{t('Student')}</TableHead><TableHead>{t('Class')}</TableHead></TableRow></TableHeader>
              <TableBody>{students.map((s) => <TableRow key={s.id}><TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} /></TableCell><TableCell>{s.name}</TableCell><TableCell>{s.classes.map((c: any) => c.name).join(', ')}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
          {failed.length > 0 && <div className="rounded-md border border-destructive/50 p-3 text-sm"><p className="font-medium">{t('Not issued:')}</p><ul className="list-disc pl-5">{failed.map((f) => <li key={f.studentId}><code>{f.studentId.slice(-8)}</code>: {f.error}</li>)}</ul></div>}
          <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
            <Button size="sm" onClick={issue} disabled={busy}>{busy ? 'Issuing…' : `Issue ${TYPE_LABEL[type].toLowerCase()}`}</Button>
          </BulkSelectionBar>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="font-medium">{canIssue ? 'Issued certificates' : 'Your certificates'}</h2>
        {certs.length === 0 ? <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No certificates issued yet. Ask the school office to issue one.')}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>{t('Number')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Student')}</TableHead><TableHead>{t('Issued')}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{certs.map((c) => <TableRow key={c.id}><TableCell className="font-mono text-xs">{c.number}</TableCell><TableCell>{TYPE_LABEL[c.type] ?? c.type}</TableCell><TableCell>{c.studentName}</TableCell><TableCell>{new Date(c.issuedAt).toLocaleDateString()}</TableCell><TableCell><div className="flex justify-end gap-1"><Button asChild size="sm" variant="outline"><Link to={`/certificates/${c.id}`}>{t('View')}</Link></Button><Button size="sm" variant="outline" onClick={() => downloadFile(`/certificates/${c.id}/pdf`, `${TYPE_LABEL[c.type] ?? 'Certificate'} ${c.number}.pdf`).catch((e) => toast.error(e.message))}>{t('PDF')}</Button></div></TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}

const BODY: Record<string, (c: any) => string> = {
  bonafide: (c) => `This is to certify that ${c.studentName} is a bonafide student of this school, currently studying in ${c.className || 'the school'}.`,
  transfer: (c) => `This is to certify that ${c.studentName} was a student of this school (${c.className || 'class not recorded'}) and is granted a transfer certificate on request of the parent.`,
  character: (c) => `This is to certify that ${c.studentName} has been a student of this school (${c.className || 'class not recorded'}) and bears a good moral character.`,
}

export function CertificateView() {
  const { t } = useT()
  const { id } = useParams()
  const [c, setC] = useState<any | null>(null)
  useEffect(() => { api<any>(`/certificates/${id}`).then(setC).catch((e) => toast.error(e.message)) }, [id])
  if (!c) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="space-y-4">
      <div className="flex gap-2 print:hidden">
        <Button asChild variant="outline" size="sm"><Link to="/certificates">{t('Back')}</Link></Button>
        <Button size="sm" onClick={() => downloadFile(`/certificates/${c.id}/pdf`, `${TYPE_LABEL[c.type] ?? 'Certificate'} ${c.number}.pdf`).catch((e) => toast.error(e.message))}>{t('Download PDF')}</Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>{t('Print')}</Button>
      </div>
      <div className="mx-auto max-w-2xl space-y-8 rounded-lg border p-10 text-center print:border-0">
        <div>
          <h2 className="text-2xl font-bold">{c.schoolName}</h2>
          <p className="mt-1 text-lg uppercase tracking-wide">{TYPE_LABEL[c.type] ?? c.type}</p>
        </div>
        <p className="text-base leading-relaxed">{c.text ?? BODY[c.type]?.(c)}</p>
        <div className="flex justify-between pt-8 text-sm">
          <span>No. {c.number}<br />Date: {new Date(c.issuedAt).toLocaleDateString()}</span>
          <span className="self-end border-t px-6 pt-1">{t('Principal')}</span>
        </div>
      </div>
    </div>
  )
}
