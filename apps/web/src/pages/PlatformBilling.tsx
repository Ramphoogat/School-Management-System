import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'

export type BillingStatus = 'none' | 'active' | 'expiring' | 'grace' | 'overdue'
interface Plan { id: string; name: string; maxStudents: number; priceMonthly: number; active: boolean; schools: number }
interface Payment { id: string; amount: number; method: string; reference: string | null; months: number; periodFrom: string; periodTo: string; note: string | null }
interface Summary { plan: { id: string; name: string; maxStudents: number } | null; students: number; endsOn: string | null; status: BillingStatus; daysLeft: number | null }

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const toPaise = (v: string) => Math.round(Number(v) * 100)

const LABEL: Record<BillingStatus, string> = { none: 'No plan', active: 'Paid up', expiring: 'Ends soon', grace: 'Overdue (grace)', overdue: 'Overdue' }
export function BillingBadge({ status }: { status: BillingStatus }) {
  return <Badge variant={status === 'overdue' ? 'destructive' : status === 'grace' || status === 'expiring' ? 'outline' : 'secondary'}>{LABEL[status]}</Badge>
}

/** The plans the platform sells. A plan sets how many students a school may have and what it costs each month. */
export function PlansManager() {
  const { t } = useT()
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [f, setF] = useState({ name: '', maxStudents: '', price: '' })
  const [editing, setEditing] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api<Plan[]>('/platform/plans').then(setPlans).catch((e) => { toast.error(e.message); setPlans([]) }), [])
  useEffect(() => { void load() }, [load])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/platform/plans', { body: { name: f.name, maxStudents: Number(f.maxStudents || 0), priceMonthly: toPaise(f.price || '0') } })
      setF({ name: '', maxStudents: '', price: '' }); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  const patch = async (p: Plan, body: object) => {
    try { await api(`/platform/plans/${p.id}`, { method: 'PATCH', body }); await load() } catch (e) { toast.error((e as Error).message) }
  }
  const remove = async (p: Plan) => {
    if (!window.confirm(`Delete the ${p.name} plan?`)) return
    try { await api(`/platform/plans/${p.id}`, { method: 'DELETE' }); await load() } catch (e) { toast.error((e as Error).message) }
  }
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    try {
      await api(`/platform/plans/${editing.id}`, { method: 'PATCH', body: { name: editing.name, maxStudents: editing.maxStudents, priceMonthly: editing.priceMonthly } })
      setEditing(null); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t('Plans')}</h2>
        <p className="text-sm text-muted-foreground">{t('A plan sets how many students a school can have and what it pays each month. Give a plan to a school from its Manage panel. Schools with no plan have no limit.')}</p>
      </div>
      {plans && plans.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card">
          {plans.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${p.active ? '' : 'opacity-60'}`}>
              <span className="min-w-32 flex-1 font-medium">{p.name}{!p.active && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('(not offered)')}</span>}</span>
              <span>{p.maxStudents === 0 ? 'Unlimited students' : `Up to ${p.maxStudents} students`}</span>
              <span className="tabular-nums">{t('{value} / month', { value: rupees(p.priceMonthly) })}</span>
              <span className="text-muted-foreground">{p.schools} school{p.schools === 1 ? '' : 's'}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>{t('Edit')}</Button>
                <Button size="sm" variant="ghost" onClick={() => patch(p, { active: !p.active })}>{p.active ? 'Stop offering' : 'Offer again'}</Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 className="size-4" /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">{t('Plan name')}<Input className="w-40" value={f.name} required minLength={2} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">{t('Student limit (0 = unlimited)')}<Input className="w-44" type="number" min={0} value={f.maxStudents} placeholder="0" onChange={(e) => setF({ ...f, maxStudents: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">{t('Price per month (₹)')}<Input className="w-40" type="number" min={0} step="0.01" value={f.price} placeholder="0" onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <Button type="submit" size="sm" disabled={busy}>{t('Add plan')}</Button>
      </form>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t('Edit plan')}</DialogTitle><DialogDescription>{t('Changes apply to every school on this plan straight away.')}</DialogDescription></DialogHeader>
          {editing && (
            <form onSubmit={saveEdit} className="space-y-3">
              <label className="block space-y-1 text-sm font-medium">{t('Name')}<Input value={editing.name} minLength={2} maxLength={60} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="block space-y-1 text-sm font-medium">{t('Student limit (0 = unlimited)')}<Input type="number" min={0} value={editing.maxStudents} onChange={(e) => setEditing({ ...editing, maxStudents: Number(e.target.value) })} /></label>
              <label className="block space-y-1 text-sm font-medium">{t('Price per month (₹)')}<Input type="number" min={0} step="0.01" value={editing.priceMonthly / 100} onChange={(e) => setEditing({ ...editing, priceMonthly: toPaise(e.target.value) })} /></label>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('Cancel')}</Button><Button type="submit" disabled={busy}>{t('Save')}</Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** One school's plan, paid-up date, and the payments received from it. */
export function BillingSection({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { t } = useT()
  const [plans, setPlans] = useState<Plan[]>([])
  const [sum, setSum] = useState<Summary | null>(null)
  const [pays, setPays] = useState<Payment[]>([])
  const [planId, setPlanId] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [pay, setPay] = useState({ amount: '', method: 'bank', months: '1', reference: '', note: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, d, ledger] = await Promise.all([api<Plan[]>('/platform/plans'), api<{ billing: Summary }>(`/platform/schools/${id}`), api<Payment[]>(`/platform/schools/${id}/payments`)])
    setPlans(p); setSum(d.billing); setPays(ledger); setPlanId(d.billing.plan?.id ?? ''); setEndsOn(d.billing.endsOn ?? '')
  }, [id])
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [load])

  const dirty = !!sum && (planId !== (sum.plan?.id ?? '') || endsOn !== (sum.endsOn ?? ''))
  const save = async () => {
    setBusy(true)
    try { await api(`/platform/schools/${id}`, { method: 'PATCH', body: { planId: planId || null, planEndsOn: endsOn || null } }); toast.success(t('Plan saved')); await load(); onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const record = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ periodTo: string }>(`/platform/schools/${id}/payments`, { body: { amount: toPaise(pay.amount || '0'), method: pay.method, months: Number(pay.months), reference: pay.reference || undefined, note: pay.note || undefined } })
      toast.success(`Payment recorded. Paid up to ${r.periodTo}.`)
      setPay({ amount: '', method: 'bank', months: '1', reference: '', note: '' }); await load(); onChanged()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  if (!sum) return <p className="text-sm text-muted-foreground">{t('Loading plan…')}</p>
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('Plan and billing')}</h3>
        <BillingBadge status={sum.status} />
        {sum.plan && <span className="text-xs text-muted-foreground">{sum.students}{sum.plan.maxStudents ? ` of ${sum.plan.maxStudents}` : ''} {t('students')}{sum.daysLeft !== null ? ` · ${sum.daysLeft >= 0 ? `${sum.daysLeft} day(s) left` : `ended ${-sum.daysLeft} day(s) ago`}` : ''}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">{t('Plan')}<select className={`${selectCls} block w-44`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">{t('No plan (no limits)')}</option>
            {plans.filter((p) => p.active || p.id === planId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">{t('Paid up to')}<Input className="w-40" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
        <Button size="sm" onClick={save} disabled={busy || !dirty}>{t('Save')}</Button>
      </div>

      {sum.plan && (
        <form onSubmit={record} className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">{t('Record a payment received')}</p>
          <p className="text-xs text-muted-foreground">{t('It pays for the months after the school is currently paid up to, or from today if that has passed.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">{t('Amount (₹)')}<Input className="w-28" type="number" min={0} step="0.01" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">{t('Months')}<Input className="w-20" type="number" min={1} max={36} required value={pay.months} onChange={(e) => setPay({ ...pay, months: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">{t('Method')}<select className={`${selectCls} block`} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['bank', 'upi', 'cash', 'cheque', 'online', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
            </label>
            <label className="text-xs text-muted-foreground">{t('Reference')}<Input className="w-36" maxLength={80} placeholder={t('Transaction id')} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          </div>
          <Button type="submit" size="sm" disabled={busy}>{t('Record payment')}</Button>
        </form>
      )}

      {pays.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {pays.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 p-2.5">
              <span className="font-medium tabular-nums">{rupees(p.amount)}</span>
              <span className="text-muted-foreground">{p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="text-xs text-muted-foreground">{p.periodFrom} to {p.periodTo} ({p.months} month{p.months === 1 ? '' : 's'})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The permanent delete. It only appears for a suspended school and asks for the address to be typed. */
export function DeleteSchool({ school, onDeleted }: { school: { id: string; name: string; slug: string | null; active: boolean }; onDeleted: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const word = school.slug ?? school.name
  const go = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ deleted: { people: number; files: number } }>(`/platform/schools/${school.id}`, { method: 'DELETE', body: { confirm: typed } })
      toast.success(`${school.name} was deleted (${r.deleted.people} people, ${r.deleted.files} files)`)
      setOpen(false); onDeleted()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="space-y-2 rounded-lg border border-destructive/40 p-3">
      <h3 className="text-sm font-semibold text-destructive">{t('Delete this school')}</h3>
      {school.active
        ? <p className="text-xs text-muted-foreground">{t('Deleting is permanent, so a school has to be suspended first. Suspend it from the schools list, then come back here.')}</p>
        : <p className="text-xs text-muted-foreground">{t('Permanently removes the school and everything in it: people, classes, records, messages and files. This cannot be undone. Ask the school to export its data first if it needs a copy.')}</p>}
      <Button size="sm" variant="destructive" disabled={school.active} onClick={() => { setTyped(''); setOpen(true) }}>{t('Delete school…')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t('Delete {name}?', { name: school.name })}</DialogTitle><DialogDescription>{t('Everything this school owns is erased for good. To confirm, type {word} below.', { word })}</DialogDescription></DialogHeader>
          <form onSubmit={go} className="space-y-3">
            <Input value={typed} autoFocus autoComplete="off" aria-label={t('Type the school\'s address to confirm')} onChange={(e) => setTyped(e.target.value)} />
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button type="submit" variant="destructive" disabled={busy || typed.trim().toLowerCase() !== word.toLowerCase()}>{busy ? 'Deleting…' : 'Delete forever'}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
