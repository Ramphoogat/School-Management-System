import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Page numbers to show: always first and last, a window around the current page, gaps as null. */
function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1])
  const out: (number | null)[] = []
  let last = 0
  for (const p of [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push(null)
    out.push(p)
    last = p
  }
  return out
}

import { useT } from '@/lib/i18n'

export function Pager({ page, pages, total, pageSize, onPage, onPageSize, sizes = [10, 25, 50, 100] }: {
  page: number; pages: number; total: number; pageSize: number
  onPage: (p: number) => void; onPageSize?: (n: number) => void; sizes?: number[]
}) {
  const { t } = useT()
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{t('Showing {from}–{to} of {total}', { from, to, total })}</span>
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            {t('Rows')}
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-8 rounded-md border border-input bg-transparent px-1.5 text-sm text-foreground">
              {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label={t('Pagination')}>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(1)} aria-label={t('First page')}><ChevronsLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Previous page')}><ChevronLeft className="h-4 w-4" /></Button>
          {pageList(page, pages).map((p, i) =>
            p === null
              ? <span key={`gap${i}`} className="px-1 text-muted-foreground">…</span>
              : <Button key={p} size="sm" variant={p === page ? 'default' : 'outline'} className="h-8 min-w-8 px-2" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</Button>,
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('Next page')}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(pages)} aria-label={t('Last page')}><ChevronsRight className="h-4 w-4" /></Button>
        </nav>
      )}
    </div>
  )
}

/** Client-side paging for lists the API already returns in full. Stays on a valid page when rows shrink. */
export function usePaged<T>(rows: T[], pageSize = 20) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const items = rows.slice((current - 1) * pageSize, current * pageSize)
  return { items, props: { page: current, pages, total: rows.length, pageSize, onPage: setPage } }
}
