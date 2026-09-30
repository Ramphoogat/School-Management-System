import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

interface Term { id: string; name: string; startDate: string; endDate: string }
interface Year { id: string; name: string; startDate: string; endDate: string; current: boolean; terms: Term[] }
interface Band { minPercent: number; grade: string }

function AddPeriod({ label, onAdd }: { label: string; onAdd: (v: { name: string; startDate: string; endDate: string }) => Promise<void> }) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [startDate, setStart] = useState('')
  const [endDate, setEnd] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try { await onAdd({ name, startDate, endDate }); setName(''); setStart(''); setEnd('') } catch (err) { toast.error((err as Error).message) }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Input className="w-40" placeholder={label} value={name} onChange={(e) => setName(e.target.value)} required />
      <label className="text-xs text-muted-foreground">{t('From')}<Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required /></label>
      <label className="text-xs text-muted-foreground">{t('To')}<Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} required /></label>
      <Button type="submit" size="sm">{t('Add')}</Button>
    </form>
  )
}

function Calendar() {
  const { t: tr } = useT()
  const [years, setYears] = useState<Year[]>([])
  const load = useCallback(() => api<{ years: Year[] }>('/academic').then((d) => setYears(d.years)).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); await load() } catch (e) { toast.error((e as Error).message) } }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{tr('Academic years and terms')}</h2>
        <p className="text-sm text-muted-foreground">{tr('New exams join the term their date falls in, so report cards can be shown one term at a time.')}</p>
      </div>
      <AddPeriod label="e.g. 2026-27" onAdd={async (v) => { await api('/academic/years', { body: v }); await load() }} />
      {years.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{tr('No academic year yet. Add the first one above.')}</p>}
      {years.map((y) => (
        <article key={y.id} className="max-w-2xl space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{y.name}</h3>
            {y.current ? <Badge>{tr('Current')}</Badge> : <Button size="sm" variant="outline" onClick={act(() => api(`/academic/years/${y.id}/current`, { method: 'POST', body: {} }))}>{tr('Make current')}</Button>}
            <span className="text-sm text-muted-foreground">{tr('{startDate} to {endDate}', { startDate: y.startDate, endDate: y.endDate })}</span>
            <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Delete ${y.name}`} onClick={act(() => api(`/academic/years/${y.id}`, { method: 'DELETE' }))}><Trash2 className="size-4" /></Button>
          </div>
          {y.terms.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {y.terms.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-muted-foreground">{tr('{startDate} to {endDate}', { startDate: t.startDate, endDate: t.endDate })}</span>
                  <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={`Delete ${t.name}`} onClick={act(() => api(`/academic/terms/${t.id}`, { method: 'DELETE' }))}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
          )}
          <AddPeriod label="Term name" onAdd={async (v) => { await api(`/academic/years/${y.id}/terms`, { body: v }); await load() }} />
        </article>
      ))}
    </section>
  )
}

function GradeScale() {
  const { t } = useT()
  const [bands, setBands] = useState<{ minPercent: string; grade: string }[]>([])
  const [isDefault, setDefault] = useState(true)
  const apply = (d: { isDefault: boolean; bands: Band[] }) => { setDefault(d.isDefault); setBands(d.bands.map((b) => ({ minPercent: String(b.minPercent), grade: b.grade }))) }
  useEffect(() => { api<{ isDefault: boolean; bands: Band[] }>('/academic/grade-scale').then(apply).catch((e) => toast.error(e.message)) }, [])
  const set = (i: number, patch: Partial<{ minPercent: string; grade: string }>) => setBands((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const save = async () => {
    try {
      apply(await api('/academic/grade-scale', { method: 'PUT', body: { bands: bands.map((b) => ({ minPercent: Number(b.minPercent), grade: b.grade })) } }))
      toast.success(t('Grade scale saved'))
    } catch (e) { toast.error((e as Error).message) }
  }
  const reset = async () => {
    try { apply(await api('/academic/grade-scale', { method: 'DELETE' })); toast.success(t('Back to the standard scale')) } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <section className="max-w-md space-y-3">
      <div>
        <h2 className="text-lg font-medium">{t('Grade scale')} {isDefault && <Badge variant="secondary" className="ml-1 align-middle">{t('Standard')}</Badge>}</h2>
        <p className="text-sm text-muted-foreground">{t('A mark earns the grade of the highest band whose minimum it reaches. One band must start at 0. Changing the scale updates every report card.')}</p>
      </div>
      <div className="space-y-2">
        {bands.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('From')}</span>
            <Input className="w-20" type="number" min={0} max={100} step="0.5" value={b.minPercent} onChange={(e) => set(i, { minPercent: e.target.value })} aria-label={t('Minimum percent')} />
            <span className="text-sm text-muted-foreground">{t('% is')}</span>
            <Input className="w-28" maxLength={12} value={b.grade} onChange={(e) => set(i, { grade: e.target.value })} aria-label={t('Grade')} />
            <Button size="icon" variant="ghost" aria-label={t('Remove band')} disabled={bands.length <= 2} onClick={() => setBands((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={bands.length >= 12} onClick={() => setBands((b) => [...b, { minPercent: '', grade: '' }])}>{t('Add band')}</Button>
        <Button size="sm" onClick={save}>{t('Save scale')}</Button>
        {!isDefault && <Button size="sm" variant="ghost" onClick={reset}>{t('Use standard scale')}</Button>}
      </div>
    </section>
  )
}

export default function Academic() {
  const { t } = useT()
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">{t('Academic year and grades')}</h1>
      <Calendar />
      <GradeScale />
    </div>
  )
}
