import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { downloadCsv, stamp } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import { Pager } from '@/components/Pager'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/lib/i18n'

export { Users } from './UsersPage'

interface AuditRow { id: string; action: string; resource: string; bulkId: string | null; createdAt: string }
interface AuditPage { rows: AuditRow[]; total: number; page: number; pageSize: number; pages: number }

export function AuditLog() {
  const { t } = useT()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<AuditPage | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(true)
    api<AuditPage>(`/audit?page=${page}&pageSize=${pageSize}`).then(setData).finally(() => setBusy(false))
  }, [page, pageSize])

  // Export everything, not just the visible page.
  const exportAll = async () => {
    const all: AuditRow[] = []
    for (let p = 1; ; p++) {
      const r = await api<AuditPage>(`/audit?page=${p}&pageSize=500`)
      all.push(...r.rows)
      if (p >= r.pages) break
    }
    downloadCsv(`audit-log-${stamp()}`, ['When', 'Action', 'Resource', 'Bulk action id'], all.map((r) => [new Date(r.createdAt).toISOString(), r.action, r.resource, r.bulkId ?? '']))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('Audit log')}</h1>
          <p className="text-sm text-muted-foreground">{data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}` : 'Loading…'}</p>
        </div>
        <Button variant="outline" size="sm" disabled={!data || data.total === 0} onClick={exportAll}>{t('Export CSV')}</Button>
      </div>
      <div className={busy ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <Table>
          <TableHeader>
            <TableRow><TableHead>{t('When')}</TableHead><TableHead>{t('Action')}</TableHead><TableHead>{t('Resource')}</TableHead><TableHead>{t('Bulk')}</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>{r.resource}</TableCell>
                <TableCell className="font-mono text-xs">{r.bulkId?.slice(0, 8) ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data && <Pager page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />}
    </div>
  )
}
