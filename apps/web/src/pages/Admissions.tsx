import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useT } from '@/lib/i18n'
import { toast } from 'sonner'
import { api, apiList } from '@/lib/api'
import { CutOffNotice } from '@/components/CutOffNotice'
import { useLiveRefresh } from '@/lib/live'
import { downloadCsv } from '@/lib/csv'
import { useAuth } from '@/lib/auth'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pager, usePaged } from '@/components/Pager'

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
export const statusVariant = (s: string) => (s === 'rejected' ? 'destructive' : s === 'approved' ? 'default' : 'secondary')

export function parseCsvRows(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('The file needs a header row and at least one row')
  const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const head = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [head[i], c])))
}

interface Credential { name: string; email: string; role: string; tempPassword: string }

export default function Admissions() {
  const { t } = useT()
  const { can } = useAuth()
  const canWrite = can('admissions', 'write')
  const canApprove = can('admissions', 'approve')
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const pg_rows = usePaged(rows)
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [creds, setCreds] = useState<Credential[] | null>(null)
  const [failed, setFailed] = useState<{ label: string; error?: string }[]>([])
  const file = useRef<HTMLInputElement>(null)
  const [f, setF] = useState({ classId: '', studentName: '', studentEmail: '', parentName: '', parentEmail: '', parentPhone: '', relationship: 'parent', whatsappOptIn: false })

  const load = useCallback(async () => {
    const r = await apiList<any>(`/admissions?status=${status}`); setRows(r.rows); setTotal(r.total); setSelected(new Set())
  }, [status])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useLiveRefresh(['admissions'], load)
  useEffect(() => { api<{ id: string; name: string }[]>('/classes').then((c) => { setClasses(c); setF((x) => ({ ...x, classId: x.classId || c[0]?.id || '' })) }) }, [])

  const pending = status === 'pending'
  const allSel = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows, selected])
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/admissions', { body: { ...f, parentPhone: f.parentPhone || undefined } })
      toast.success(t('Application added for approval'))
      setF((x) => ({ ...x, studentName: '', studentEmail: '', parentName: '', parentEmail: '', parentPhone: '' }))
      await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files?.[0]; e.target.value = ''
    if (!fl) return
    try {
      const r = await api<{ succeeded: number; total: number; failed: { row: number; error: string }[] }>('/admissions/import', { body: { rows: parseCsvRows(await fl.text()) } })
      toast[r.failed.length ? 'warning' : 'success'](`Imported ${r.succeeded} of ${r.total} row(s)`)
      setFailed(r.failed.map((x) => ({ label: `Row ${x.row}`, error: x.error })))
      await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { id: string; error?: string }[]; credentials: Credential[] }>('/admissions/bulk-approve', { body: { ids: [...selected], decision: confirm, reason: reason || undefined } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} succeeded`)
      setFailed(r.failed.map((x) => ({ label: x.id.slice(-8), error: x.error })))
      if (r.credentials.length) setCreds(r.credentials)
      setConfirm(null); setReason(''); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const downloadCreds = () => {
    if (!creds) return
    const csv = ['name,email,role,temporary_password', ...creds.map((c) => `${c.name},${c.email},${c.role},${c.tempPassword}`)].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'new-accounts.csv'; a.click()
  }

  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('Admissions')}</h1>

      {canWrite && (
        <div className="space-y-3">
          <form onSubmit={add} className="grid max-w-4xl gap-2 sm:grid-cols-3">
            <select className={selectCls} aria-label={t('Class')} value={f.classId} onChange={(e) => set('classId', e.target.value)} required>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <Input placeholder={t('Student name')} value={f.studentName} onChange={(e) => set('studentName', e.target.value)} required />
            <Input type="email" placeholder={t('Student email (login)')} value={f.studentEmail} onChange={(e) => set('studentEmail', e.target.value)} required />
            <Input placeholder={t('Parent name')} value={f.parentName} onChange={(e) => set('parentName', e.target.value)} required />
            <Input type="email" placeholder={t('Parent email (login)')} value={f.parentEmail} onChange={(e) => set('parentEmail', e.target.value)} required />
            <Input placeholder={t('Parent phone (+91…)')} value={f.parentPhone} onChange={(e) => set('parentPhone', e.target.value)} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.whatsappOptIn} onCheckedChange={(v) => set('whatsappOptIn', !!v)} /> {t('Parent agreed to WhatsApp messages')}</label>
            <Button type="submit">{t('Add application')}</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
            <Button variant="outline" size="sm" onClick={() => file.current?.click()}>{t('Import CSV')}</Button>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv('admissions-template', ['studentName', 'studentEmail', 'parentName', 'parentEmail', 'parentPhone', 'relationship', 'class', 'whatsappOptIn'], [['Asha Rao', 'asha@example.com', 'Meera Rao', 'meera@example.com', '+919800000001', 'mother', classes[0]?.name ?? 'Grade 8-A', 'yes']])}>{t('Download template')}</Button>
            <span className="text-xs text-muted-foreground">{t('Columns: studentName, studentEmail, parentName, parentEmail, parentPhone, relationship, class, whatsappOptIn (yes/no)')}</span>
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium">{t('Not processed:')}</p>
          <ul className="list-disc pl-5">{failed.map((x, i) => <li key={i}>{x.label}: {x.error}</li>)}</ul>
        </div>
      )}

      <div className="flex gap-1">
        {(['pending', 'approved', 'rejected'] as const).map((s) => <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(s)}>{s}</Button>)}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{canWrite && pending ? t('No {status} applications. Add one above or import a CSV.', { status: t(status) }) : t('No {status} applications.', { status: t(status) })}</p>
      ) : (
        <>
<Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">{canApprove && pending && <Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={t('Select all')} />}</TableHead>
              <TableHead>{t('Student')}</TableHead><TableHead>{t('Class')}</TableHead><TableHead>{t('Parent')}</TableHead><TableHead>{t('Status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg_rows.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{canApprove && pending && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}</TableCell>
                <TableCell>{r.studentName}<div className="text-xs text-muted-foreground">{r.studentEmail}</div></TableCell>
                <TableCell>{r.className}</TableCell>
                <TableCell>{r.parentName}<div className="text-xs text-muted-foreground">{r.parentEmail}{r.whatsappOptIn ? ' · WhatsApp OK' : ''}</div></TableCell>
                <TableCell><Badge variant={statusVariant(r.status)} className="capitalize">{r.status}</Badge>{r.reason && <div className="text-xs text-muted-foreground">{r.reason}</div>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
<CutOffNotice shown={rows.length} total={total} />
<Pager {...pg_rows.props} />
</>
      )}

      {canApprove && (
        <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" onClick={() => setConfirm('approve')}>{t('Approve')}</Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirm('reject')}>{t('Reject')}</Button>
        </BulkSelectionBar>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? 'Admit' : 'Reject'} {selected.size} application(s)?</AlertDialogTitle>
            <AlertDialogDescription>{confirm === 'approve' ? 'Student and parent accounts are created, students join their class and parent links are approved.' : 'This reason is stored against every rejected application.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder={confirm === 'reject' ? 'Reason (required)' : 'Note (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || (confirm === 'reject' && !reason.trim())} onClick={(e) => { e.preventDefault(); run() }}>{busy ? 'Working…' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('New accounts created')}</DialogTitle>
            <DialogDescription>{t('Temporary passwords are shown only now and are not stored. Download or copy them and hand them out. Each person must change theirs after first sign-in.')}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>{t('Name')}</TableHead><TableHead>{t('Email')}</TableHead><TableHead>{t('Role')}</TableHead><TableHead>{t('Temporary password')}</TableHead></TableRow></TableHeader>
            <TableBody>{creds?.map((c) => <TableRow key={c.email}><TableCell>{c.name}</TableCell><TableCell>{c.email}</TableCell><TableCell className="capitalize">{c.role}</TableCell><TableCell className="font-mono">{c.tempPassword}</TableCell></TableRow>)}</TableBody>
          </Table>
          <Button onClick={downloadCreds}>{t('Download CSV')}</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
