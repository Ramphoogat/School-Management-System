import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useT } from '@/lib/i18n'
import { toast } from 'sonner'
import { api, apiList } from '@/lib/api'
import { CutOffNotice } from '@/components/CutOffNotice'
import { downloadCsv, stamp } from '@/lib/csv'
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
import { Calculator } from '@/components/Calculator'
import { CalculatorIcon, ChevronDown, ChevronRight } from 'lucide-react'

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
export const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Paise of a paid invoice that can still be refunded. */
const refundLeft = (i: any) => Math.max(0, (i.payments?.[0]?.amount ?? i.amount) - (i.refundedAmount ?? 0))
const feeVariant = (i: any) => (i.status === 'paid' ? 'default' : i.status === 'waived' || i.status === 'refunded' ? 'secondary' : i.overdue ? 'destructive' : 'outline')
const feeLabel = (i: any) => (i.status === 'unpaid' ? (i.overdue ? 'Overdue' : 'Unpaid') : i.status === 'paid' ? 'Paid' : i.status === 'refunded' ? 'Refunded' : 'Waived')

function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load the payment window'))
    document.body.appendChild(s)
  })
}

const dateOnly = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Every fee for one student, whatever the page filters say, with what has been paid, waived, refunded and still owed. */
function StudentFees({ studentId, name }: { studentId: string; name: string }) {
  const { t } = useT()
  const [fees, setFees] = useState<any[] | null>(null)
  useEffect(() => {
    api<any[]>(`/fees/invoices?studentId=${studentId}`).then(setFees).catch((e) => { toast.error(e.message); setFees([]) })
  }, [studentId])
  if (fees === null) return <p className="p-2 text-sm text-muted-foreground">{t('Loading fees…')}</p>
  if (fees.length === 0) return <p className="p-2 text-sm text-muted-foreground">{t('No fees for {name} yet.', { name })}</p>

  const sum = (pred: (f: any) => boolean) => fees.filter(pred).reduce((a, f) => a + f.amount, 0)
  const stats = [
    { label: 'Billed', value: sum((f) => f.status !== 'waived'), tone: '' },
    { label: 'Paid', value: sum((f) => f.status === 'paid'), tone: 'text-emerald-500' },
    { label: 'Still to pay', value: sum((f) => f.status === 'unpaid'), tone: sum((f) => f.status === 'unpaid' && f.overdue) > 0 ? 'text-red-500' : '' },
    { label: 'Waived', value: sum((f) => f.status === 'waived'), tone: 'text-muted-foreground' },
    { label: 'Refunded', value: fees.reduce((a, f) => a + (f.refundedAmount ?? 0), 0), tone: 'text-muted-foreground' },
  ]
  return (
    <div className="space-y-3 p-2 sm:p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('Fee structure for {name}', { name })}</h3>
        <span className="text-xs text-muted-foreground">{t('{length} fee(s)', { length: fees.length })}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((x) => (
          <div key={x.label} className="rounded-lg border bg-background/60 p-2">
            <p className="text-[11px] text-muted-foreground">{x.label}</p>
            <p className={`text-sm font-semibold tabular-nums ${x.tone}`}>{inr(x.value)}</p>
          </div>
        ))}
      </div>
      <div tabIndex={0} className="overflow-x-auto rounded-lg border bg-background/60 focus-visible:outline-2 focus-visible:outline-ring">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">{t('Fee')}</th><th className="px-3 py-2 font-medium">{t('Amount')}</th><th className="px-3 py-2 font-medium">{t('Due')}</th><th className="px-3 py-2 font-medium">{t('Status')}</th><th className="px-3 py-2 font-medium">{t('Details')}</th></tr></thead>
          <tbody>
            {fees.map((f) => {
              const p = f.payments?.[0]
              return (
                <tr key={f.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 font-medium">{f.title}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{inr(f.amount)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{f.dueDate}</td>
                  <td className="px-3 py-2"><Badge variant={feeVariant(f) as any}>{feeLabel(f)}</Badge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {f.status === 'paid' && p && `Paid ${dateOnly(p.paidAt)} by ${p.method}${p.reference ? ` (${p.reference})` : ''}`}
                    {f.status === 'refunded' && (f.refund ? `Refunded: ${f.refund.reason}` : 'Refunded')}
                    {f.status === 'paid' && f.refundedAmount > 0 && ` · ${inr(f.refundedAmount)} refunded`}
                    {f.status === 'waived' && (f.waiverNote ? `Waived: ${f.waiverNote}` : 'Waived')}
                    {f.status === 'unpaid' && f.overdue && 'Overdue'}
                    {f.status === 'unpaid' && !f.overdue && f.waiverStatus === 'requested' && 'Waiver pending'}
                    {f.status === 'unpaid' && !f.overdue && f.waiverStatus === 'rejected' && 'Waiver declined'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Fees() {
  const { t } = useT()
  const { user, can } = useAuth()
  const staff = can('fees', 'read')
  const canBulk = can('fees', 'bulk_write')
  const canWaiver = can('fees', 'write')
  const canRefund = can('fees', 'refund')
  const [rows, setRows] = useState<any[]>([])
  const [matched, setMatched] = useState(0)
  const pg_rows = usePaged(rows)
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payOpen, setPayOpen] = useState(false)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ id: string; error?: string }[]>([])
  const [razorpay, setRazorpay] = useState(false)
  const [waiverFor, setWaiverFor] = useState<any | null>(null)
  const [waiverReason, setWaiverReason] = useState('')
  const [refundFor, setRefundFor] = useState<any | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('') // rupees; empty = everything still refundable
  const [reminding, setReminding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null) // the invoice row that is expanded
  const [calcOpen, setCalcOpen] = useState(false) // calculator on small screens
  const [nf, setNf] = useState({ classId: '', title: '', rupees: '', dueDate: new Date().toISOString().slice(0, 10) })

  const load = useCallback(async () => {
    const q = new URLSearchParams()
    if (classId) q.set('classId', classId)
    if (status) q.set('status', status)
    const r = await apiList<any>(`/fees/invoices?${q}`); setRows(r.rows); setMatched(r.total); setSelected(new Set())
  }, [classId, status])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])
  useEffect(() => {
    if (staff) api<{ id: string; name: string }[]>('/classes').then((c) => { setClasses(c); setNf((x) => ({ ...x, classId: c[0]?.id ?? '' })) })
    api<{ razorpay: boolean }>('/fees/config').then((c) => setRazorpay(c.razorpay))
  }, [staff])

  const unpaidRows = useMemo(() => rows.filter((r) => r.status === 'unpaid'), [rows])
  const allSel = unpaidRows.length > 0 && selected.size === unpaidRows.length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const total = (ids: Set<string>) => rows.filter((r) => ids.has(r.id)).reduce((a, r) => a + r.amount, 0)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await api<{ created: number; skipped: number }>('/fees/invoices', { body: { classId: nf.classId, title: nf.title, amount: Math.round(Number(nf.rupees) * 100), dueDate: nf.dueDate } })
      toast.success(`${r.created} invoice(s) created${r.skipped ? `, ${r.skipped} already had this fee` : ''}`)
      setNf((x) => ({ ...x, title: '', rupees: '' })); await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const bulkPay = async () => {
    setBusy(true)
    try {
      const r = await api<{ succeeded: number; total: number; failed: { id: string; error?: string }[] }>('/fees/bulk-pay', { body: { ids: [...selected], method, reference: reference || undefined } })
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} marked paid`)
      setFailed(r.failed); setPayOpen(false); setReference(''); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const requestWaiver = async () => {
    try {
      await api(`/fees/invoices/${waiverFor.id}/request-waiver`, { body: { reason: waiverReason } })
      toast.success(t('Waiver sent to the principal')); setWaiverFor(null); setWaiverReason(''); await load()
    } catch (err) { toast.error((err as Error).message) }
  }

  const refund = async () => {
    if (!refundFor) return
    setBusy(true)
    try {
      const rupees = refundAmount.trim() === '' ? null : Number(refundAmount)
      if (rupees !== null && (!Number.isFinite(rupees) || rupees <= 0)) throw new Error('Enter an amount greater than zero')
      const r = await api<{ method: string; status: string }>(`/fees/invoices/${refundFor.id}/refund`, { body: { reason: refundReason, ...(rupees !== null ? { amount: Math.round(rupees * 100) } : {}) } })
      toast.success(r.method === 'razorpay' ? (r.status === 'processed' ? 'Refund sent to the original payment method' : 'Refund started. It can take a few days to reach the account.') : 'Refund recorded. Hand the money back at the office.')
      setRefundFor(null); setRefundReason(''); setRefundAmount(''); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const sendReminders = async () => {
    setReminding(true)
    try {
      const r = await api<{ due: number; overdue: number }>('/fees/reminders/run', { body: {} })
      toast[r.due + r.overdue ? 'success' : 'info'](r.due + r.overdue ? `Sent ${r.due} due-soon and ${r.overdue} overdue reminder(s)` : 'Nothing new to remind. Each fee is only reminded once at each stage.')
    } catch (err) { toast.error((err as Error).message) } finally { setReminding(false) }
  }

  const payOnline = async (inv: any) => {
    try {
      const o = await api<{ orderId: string; amount: number; currency: string; keyId: string; title: string }>(`/fees/invoices/${inv.id}/online-order`, { method: 'POST', body: {} })
      await loadCheckout()
      new (window as any).Razorpay({
        key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: 'School fees', description: o.title,
        handler: async (resp: any) => {
          try { await api(`/fees/invoices/${inv.id}/online-verify`, { body: resp }); toast.success(t('Payment received. A receipt is on its way.')); await load() }
          catch (e) { toast.error((e as Error).message) }
        },
      }).open()
    } catch (err) { toast.error((err as Error).message) }
  }

  const cols = (canBulk ? 1 : 0) + (staff || user?.role === 'parent' ? 1 : 0) + 5

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-6">
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('Fees')}</h1>
        <Button variant="outline" size="sm" className="gap-1.5 lg:hidden" onClick={() => setCalcOpen((v) => !v)}><CalculatorIcon className="h-4 w-4" /> {t('Calculator')}</Button>
      </div>
      {calcOpen && <div className="max-w-xs lg:hidden"><Calculator /></div>}

      {canBulk && (
        <form onSubmit={create} className="flex max-w-4xl flex-wrap items-end gap-2">
          <select className={selectCls} aria-label={t('Class')} value={nf.classId} onChange={(e) => setNf({ ...nf, classId: e.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input className="w-44" placeholder={t('Fee title (e.g. Term 1)')} value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} required />
          <Input className="w-32" type="number" min={1} step="0.01" placeholder={t('Amount ₹')} value={nf.rupees} onChange={(e) => setNf({ ...nf, rupees: e.target.value })} required />
          <Input className="w-40" type="date" value={nf.dueDate} onChange={(e) => setNf({ ...nf, dueDate: e.target.value })} required />
          <Button type="submit">{t('Create invoices for class')}</Button>
          <Button type="button" variant="outline" disabled={reminding} onClick={sendReminders} title={t('Remind students and parents about fees due soon or overdue. Runs by itself every day; nothing is sent twice.')}>{reminding ? 'Sending…' : 'Send reminders now'}</Button>
        </form>
      )}

      {staff && (
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} aria-label={t('Class')} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">{t('All classes')}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={selectCls} aria-label={t('Status')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('All statuses')}</option><option value="unpaid">{t('Unpaid')}</option><option value="overdue">{t('Overdue')}</option><option value="paid">{t('Paid')}</option><option value="waived">{t('Waived')}</option><option value="refunded">{t('Refunded')}</option>
          </select>
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => downloadCsv(`fees-${stamp()}`, ['Student', 'Class', 'Fee', 'Amount (INR)', 'Due date', 'Status', 'Paid via'], rows.map((r) => [r.studentName, r.className, r.title, (r.amount / 100).toFixed(2), r.dueDate, r.status === 'unpaid' && r.overdue ? 'overdue' : r.status, r.payments?.[0]?.method ?? '']))}>{t('Export CSV')}</Button>
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium">{t('Not processed:')}</p>
          <ul className="list-disc pl-5">{failed.map((f) => <li key={f.id}><code>{f.id.slice(-8)}</code>: {f.error}</li>)}</ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {staff ? 'No invoices match. Create fees for a class above.' : 'No fees to show. Invoices from the school office appear here.'}
        </p>
      ) : (
        <>
<Table>
          <TableHeader>
            <TableRow>
              {canBulk && <TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={() => setSelected(allSel ? new Set() : new Set(unpaidRows.map((r) => r.id)))} aria-label={t('Select all unpaid')} /></TableHead>}
              {(staff || user?.role === 'parent') && <TableHead>{t('Student')}</TableHead>}
              <TableHead>{t('Fee')}</TableHead><TableHead>{t('Amount')}</TableHead><TableHead>{t('Due')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead><span className="sr-only">{t('Actions')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg_rows.items.map((r) => (
              <Fragment key={r.id}>
              <TableRow
                className="cursor-pointer"
                onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, [role=checkbox], select')) return; setOpenId(openId === r.id ? null : r.id) }}
              >
                {canBulk && <TableCell>{r.status === 'unpaid' && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}</TableCell>}
                {(staff || user?.role === 'parent') && <TableCell><div className="flex items-center gap-1.5"><button type="button" aria-expanded={openId === r.id} aria-label={r.studentName} onClick={() => setOpenId(openId === r.id ? null : r.id)} className="rounded focus-visible:outline-2 focus-visible:outline-ring">{openId === r.id ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}</button><div>{r.studentName}<div className="text-xs text-muted-foreground">{r.className}</div></div></div></TableCell>}
                <TableCell>{r.title}{r.waiverStatus === 'requested' && <div className="text-xs text-muted-foreground">{t('Waiver pending')}</div>}{r.waiverStatus === 'rejected' && <div className="text-xs text-muted-foreground">{t('Waiver declined')}</div>}</TableCell>
                <TableCell>{inr(r.amount)}</TableCell>
                <TableCell>{r.dueDate}</TableCell>
                <TableCell>
                  <Badge variant={feeVariant(r) as any}>{feeLabel(r)}</Badge>
                  {r.refund && <div className="mt-0.5 text-xs text-muted-foreground" title={r.refund.reason}>{r.refund.method === 'razorpay' ? (r.refund.status === 'processed' ? 'Refunded online' : r.refund.status === 'failed' ? 'Online refund failed' : 'Online refund pending') : 'Handed back at the office'}</div>}
                </TableCell>
                <TableCell className="text-right">
                  {canRefund && r.status === 'paid' && <Button size="sm" variant="ghost" onClick={() => setRefundFor(r)}>{t('Refund')}</Button>}
                  {canWaiver && r.status === 'unpaid' && r.waiverStatus !== 'requested' && <Button size="sm" variant="ghost" onClick={() => setWaiverFor(r)}>{t('Request waiver')}</Button>}
                  {user?.role === 'parent' && r.status === 'unpaid' && (razorpay ? <Button size="sm" onClick={() => payOnline(r)}>{t('Pay online')}</Button> : <span className="text-xs text-muted-foreground">{t('Pay at the school office')}</span>)}
                </TableCell>
              </TableRow>
              {openId === r.id && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={cols} className="whitespace-normal p-0"><StudentFees studentId={r.studentId} name={r.studentName || 'this student'} /></TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
<CutOffNotice shown={rows.length} total={matched} />
<Pager {...pg_rows.props} />
</>
      )}

      {canBulk && (
        <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" onClick={() => setPayOpen(true)}>{t('Mark paid')}</Button>
        </BulkSelectionBar>
      )}

      <AlertDialog open={payOpen} onOpenChange={setPayOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Mark {size} invoice(s) paid?', { size: selected.size })}</AlertDialogTitle>
            <AlertDialogDescription>{t('Total {value}. Receipts go to students and parents.', { value: inr(total(selected)) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2">
            <select className={selectCls} aria-label={t('Payment method')} value={method} onChange={(e) => setMethod(e.target.value)}>{['cash', 'upi', 'card', 'bank', 'cheque'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <Input placeholder={t('Reference (optional)')} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); bulkPay() }}>{busy ? 'Working…' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!refundFor} onOpenChange={(o) => { if (!o) { setRefundFor(null); setRefundAmount('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{refundAmount ? t('Refund {amount}?', { amount: inr(Math.round(Number(refundAmount || 0) * 100)) }) : t('Refund {amount} (all that is left)?', { amount: refundFor ? inr(refundLeft(refundFor)) : '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {refundFor?.studentName}: {refundFor?.title}. {refundFor && refundFor.refundedAmount > 0 ? `${inr(refundFor.refundedAmount)} has already been refunded. ` : ''}{refundFor?.payments?.[0]?.method === 'online' ? 'This was paid online, so the money goes back to the original card or account. It can take 5 to 7 working days.' : 'This was paid at the office, so give the money back and this records it.'} {t('The student and parents are told. This cannot be undone.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block space-y-1 text-sm">
            <span>{t('Amount to refund in rupees. Leave empty to refund all {amount} that is left.', { amount: refundFor ? inr(refundLeft(refundFor)) : '' })}</span>
            <Input type="number" min={0.01} step="0.01" max={refundFor ? refundLeft(refundFor) / 100 : undefined} placeholder={t('Full amount')} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
          </label>
          <Textarea placeholder={t('Reason (required)')} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || refundReason.trim().length < 3} onClick={(e) => { e.preventDefault(); refund() }}>{busy ? 'Working…' : 'Refund'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!waiverFor} onOpenChange={(o) => !o && setWaiverFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Request a fee waiver')}</AlertDialogTitle>
            <AlertDialogDescription>{t('{student}: {title} ({amount}). The principal decides.', { student: waiverFor?.studentName, title: waiverFor?.title, amount: waiverFor ? inr(waiverFor.amount) : '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder={t('Reason (required)')} value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={waiverReason.trim().length < 3} onClick={(e) => { e.preventDefault(); requestWaiver() }}>{t('Send request')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <aside className="hidden lg:block">
      <div className="sticky top-0 space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalculatorIcon className="h-4 w-4" /> {t('Calculator')}</h2>
        <Calculator />
      </div>
    </aside>
    </div>
  )
}
