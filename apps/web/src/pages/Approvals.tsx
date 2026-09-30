import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { BulkSelectionBar } from '@/components/BulkSelectionBar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Pager, usePaged } from '@/components/Pager'
import { useT } from '@/lib/i18n'

interface Req {
  id: string
  targetUserId: string
  requestedRole: string
  targetName: string
  requestedByName: string
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
  reason: string | null
  createdAt: string
}
interface BulkResult {
  total: number
  succeeded: number
  failed: { id: string; error?: string }[]
}

const FILTERS = ['pending', 'approved', 'rejected'] as const

export default function Approvals() {
  const { t } = useT()
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('pending')
  const [rows, setRows] = useState<Req[]>([])
  const pg_rows = usePaged(rows)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await api<Req[]>(`/role-requests?status=${status}`))
      setSelected(new Set())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['role_requests'], load)

  const allSelected = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows, selected])
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const r = await api<BulkResult>('/role-requests/bulk-approve', {
        body: { ids: [...selected], decision: confirm, reason: reason || undefined },
      })
      setResult(r)
      toast[r.failed.length ? 'warning' : 'success'](`${r.succeeded} of ${r.total} succeeded`)
      setConfirm(null)
      setReason('')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rejectNeedsReason = confirm === 'reject' && !reason.trim()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('Role approvals')}</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button key={f} size="sm" variant={f === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(f)}>
              {f}
            </Button>
          ))}
        </div>
      </div>

      {result && result.failed.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3 text-sm">
          <p className="font-medium">
            {t('{succeeded} of {total} succeeded. Not processed:', { succeeded: result.succeeded, total: result.total })}</p>
          <ul className="list-disc pl-5">
            {result.failed.map((f) => (
              <li key={f.id}>
                <code>{f.id}</code>: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">{t('Loading…')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('No {status} role requests. Requests submitted by clerks and teachers appear here for approval.', { status: t(status) })}</div>
      ) : (
        <>
<Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {status === 'pending' && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    aria-label={t('Select all')}
                  />
                )}
              </TableHead>
              <TableHead>{t('User')}</TableHead>
              <TableHead>{t('Requested by')}</TableHead>
              <TableHead>{t('Requested role')}</TableHead>
              <TableHead>{t('Note')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg_rows.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.status === 'pending' && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={t('Select row')} />}
                </TableCell>
                <TableCell>{r.targetName}</TableCell>
                <TableCell>{r.requestedByName}</TableCell>
                <TableCell className="capitalize">{r.requestedRole}</TableCell>
                <TableCell>{r.reason ?? r.note ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={r.status === 'rejected' ? 'destructive' : r.status === 'approved' ? 'default' : 'secondary'} className="capitalize">
                    {r.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
<Pager {...pg_rows.props} />
</>
      )}

      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => setConfirm('approve')}>{t('Approve')}</Button>
        <Button size="sm" variant="destructive" onClick={() => setConfirm('reject')}>{t('Reject')}</Button>
      </BulkSelectionBar>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'approve' ? 'Approve' : 'Reject'} {selected.size} request(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reject'
                ? 'This reason is stored against every rejected request.'
                : 'Each role will be applied immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={confirm === 'reject' ? 'Reason (required)' : 'Note (optional)'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || rejectNeedsReason} onClick={(e) => { e.preventDefault(); run() }}>
              {busy ? 'Working…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
