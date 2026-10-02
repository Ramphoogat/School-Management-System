import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import { api, downloadFile } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { downloadCsv, stamp } from '@/lib/csv'
import { rupees, type BillingStatus } from '@/pages/PlatformBilling'

const ROLES = ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin']
interface ImportRow { name: string; email: string; role: string; phone?: string }
interface ImportResult { created: { name: string; email: string; role: string; tempPassword: string }[]; skipped: { row: number; email: string; reason: string }[] }

/** Reads CSV text, with quoted cells, into rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = [] }
    else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

export interface Billing { plan: { name: string; maxStudents: number; priceMonthly: number } | null; students: number; endsOn: string | null; status: BillingStatus; daysLeft: number | null }

/** What the school's plan allows and where it stands, and a copy of the school's own data. */
export default function SchoolPlan() {
  const { can } = useAuth()
  const { t } = useT()
  const [b, setB] = useState<Billing | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Billing>('/school/billing').then(setB).catch((e) => toast.error(e.message)) }, [])

  const [rows, setRows] = useState<ImportRow[]>([])
  const [problem, setProblem] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const pickFile = async (f: File | undefined) => {
    setResult(null); setRows([]); setProblem('')
    if (!f) return
    const [head, ...body] = parseCsv(await f.text())
    const col = (n: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === n)
    const [iName, iEmail, iRole, iPhone] = ['name', 'email', 'role', 'phone'].map(col)
    if (iName < 0 || iEmail < 0 || iRole < 0) return setProblem(t('The file needs the columns name, email and role. Download the template to see the layout.'))
    const out = body.map((r) => ({ name: (r[iName] ?? '').trim(), email: (r[iEmail] ?? '').trim(), role: (r[iRole] ?? '').trim().toLowerCase(), phone: iPhone >= 0 ? (r[iPhone] ?? '').trim() : '' }))
    const bad = out.findIndex((r) => r.name.length < 2 || !ROLES.includes(r.role))
    if (bad >= 0) return setProblem(t('Row {n}: the name is missing or the role is not one of {roles}.', { n: bad + 2, roles: ROLES.join(', ') }))
    if (out.length > 500) return setProblem(t('A file can add up to 500 people at a time.'))
    if (!out.length) return setProblem(t('The file has no rows.'))
    setRows(out)
  }
  const runImport = async () => {
    setBusy(true)
    try {
      const r = await api<ImportResult>('/users/import', { method: 'POST', body: { rows } })
      setResult(r); setRows([])
      toast.success(t('{n} people added', { n: r.created.length }))
      api<Billing>('/school/billing').then(setB).catch(() => {})
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const exportData = async () => {
    setBusy(true)
    try { await downloadFile('/school/export', `school-data-${new Date().toISOString().slice(0, 10)}.json`); toast.success(t('Your school data was downloaded')) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const share = b?.plan?.maxStudents ? Math.min(100, Math.round((b.students / b.plan.maxStudents) * 100)) : null
  const message: Record<string, string> = {
    expiring: t('Your plan ends soon. Ask the platform administrator to renew it.'),
    grace: t('Your plan has ended. Renew it soon: new students cannot be added if it stays unpaid.'),
    overdue: t('Your plan has ended. New students cannot be added until it is renewed. Everything else keeps working.'),
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('Plan and data')}</h1>
        <p className="text-sm text-muted-foreground">{t('What your plan allows, and a copy of your school’s records.')}</p>
      </div>

      {b && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-medium">{t('Your plan')}</h2>
          {!b.plan ? (
            <p className="text-sm text-muted-foreground">{t('No plan has been set for this school, so there are no limits.')}</p>
          ) : (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">{t('Plan')}</dt><dd className="font-medium">{b.plan.name}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('Price per month')}</dt><dd className="font-medium">{rupees(b.plan.priceMonthly)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('Paid up to')}</dt><dd className="font-medium">{b.endsOn ?? t('No end date')}</dd></div>
              </dl>
              <div className="space-y-1">
                <p className="text-sm">{b.plan.maxStudents ? t('{n} of {max} students', { n: b.students, max: b.plan.maxStudents }) : t('{n} students (no limit)', { n: b.students })}</p>
                {share !== null && (
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label={t('Students compared with the plan limit')}>
                    <div className={`h-full rounded-full ${share >= 100 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${share}%` }} />
                  </div>
                )}
              </div>
              {message[b.status] && <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{message[b.status]}</p>}
            </>
          )}
        </section>
      )}

      {can('users', 'manage') && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-medium">{t('Add school records')}</h2>
          <p className="text-sm text-muted-foreground">{t('Add many people at once from a CSV file with the columns name, email, role and phone. Each person gets a temporary password and must change it at first sign-in. Students count towards your plan limit.')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => downloadCsv('people-template', ['name', 'email', 'role', 'phone'], [['Asha Rao', 'asha@example.com', 'student', '9876543210']])}><Download className="mr-1.5 h-4 w-4" />{t('Download template')}</Button>
            <input type="file" accept=".csv,text/csv" aria-label={t('Choose a CSV file')} className="text-sm" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm">{t('{n} people are ready to add.', { n: rows.length })}</p>
              <Button onClick={runImport} disabled={busy}><Upload className="mr-1.5 h-4 w-4" />{busy ? t('Preparing…') : t('Add these people')}</Button>
            </div>
          )}
          {result && (
            <div className="space-y-2 text-sm" role="status">
              <p>{t('{n} people added', { n: result.created.length })}{result.skipped.length > 0 && ` · ${t('{n} skipped', { n: result.skipped.length })}`}</p>
              {result.created.length > 0 && (
                <>
                  <Button variant="outline" onClick={() => downloadCsv(`new-people-${stamp()}`, ['name', 'email', 'role', 'temporary password'], result.created.map((c) => [c.name, c.email, c.role, c.tempPassword]))}><Download className="mr-1.5 h-4 w-4" />{t('Download temporary passwords')}</Button>
                  <p className="text-xs text-muted-foreground">{t('Keep this file safe: the passwords cannot be shown again.')}</p>
                </>
              )}
              {result.skipped.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">{result.skipped.map((k) => <li key={k.row}>{t('Row {n}', { n: k.row + 1 })}: {k.email || '—'}, {k.reason}</li>)}</ul>
              )}
            </div>
          )}
        </section>
      )}

      {can('school', 'export') && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-medium">{t('Export your school’s data')}</h2>
          <p className="text-sm text-muted-foreground">{t('Downloads every record your school owns (people, classes, attendance, results, fees, announcements and more) as one file. It does not include passwords, private messages or uploaded files. You can make one export every few minutes.')}</p>
          <Button onClick={exportData} disabled={busy}><Download className="mr-1.5 h-4 w-4" />{busy ? t('Preparing…') : t('Download school data')}</Button>
        </section>
      )}
    </div>
  )
}
