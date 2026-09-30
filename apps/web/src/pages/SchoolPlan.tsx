import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { api, downloadFile } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { rupees, type BillingStatus } from '@/pages/PlatformBilling'

export interface Billing { plan: { name: string; maxStudents: number; priceMonthly: number } | null; students: number; endsOn: string | null; status: BillingStatus; daysLeft: number | null }

/** What the school's plan allows and where it stands, and a copy of the school's own data. */
export default function SchoolPlan() {
  const { can } = useAuth()
  const { t } = useT()
  const [b, setB] = useState<Billing | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Billing>('/school/billing').then(setB).catch((e) => toast.error(e.message)) }, [])

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
