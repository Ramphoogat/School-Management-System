import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileText, ShieldAlert } from 'lucide-react'
import { api, downloadFile } from '@/lib/api'
import { useLiveRefresh } from '@/lib/live'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Pager, usePaged } from '@/components/Pager'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useT } from '@/lib/i18n'

type Status = 'open' | 'reviewed' | 'dismissed'
interface Who { id: string; name: string; role: string }
interface ReportRow { id: string; status: Status; reason: string; createdAt: string; reviewedAt: string | null; reviewNote: string | null; reviewedBy: string | null; reporter: Who | null; reported: Who | null }
interface Detail {
  id: string; status: Status; reason: string; createdAt: string; reviewNote: string | null; flaggedMessageId: string | null
  reporter: Who | null; reported: Who | null
  messages: { id: string; body: string; deleted: boolean; edited: boolean; senderId: string; senderName: string; senderRole: string; createdAt: string; attachments: { id: string; name: string; size: number }[] }[]
}

const stamp = (d: string) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const variant = (s: Status) => (s === 'open' ? 'destructive' : s === 'reviewed' ? 'default' : 'secondary')

/** Reported conversations. Only what someone reported can be opened here, and every opening is recorded. */
export function MessageReports() {
  const { t } = useT()
  const [status, setStatus] = useState<Status>('open')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const pg = usePaged(rows ?? [])

  const load = useCallback(() => api<ReportRow[]>(`/messages/reports?status=${status}`).then(setRows).catch((e) => { toast.error(e.message); setRows([]) }), [status])
  useEffect(() => { setRows(null); void load() }, [load])
  useLiveRefresh(['message_reports'], load)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldAlert className="h-6 w-6" /> {t('Message reports')}</h1>
        <p className="text-sm text-muted-foreground">{t('Conversations that someone reported. You can read only these, and each time you open one it is recorded in the audit log.')}</p>
      </div>

      <div className="flex gap-1">
        {(['open', 'reviewed', 'dismissed'] as Status[]).map((s) => <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} className="capitalize" onClick={() => setStatus(s)}>{s}</Button>)}
      </div>

      {rows === null ? <p className="text-sm text-muted-foreground">{t('Loading…')}</p> : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No {status} reports.', { status: t(status) })}</p>
      ) : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>{t('Reported')}</TableHead><TableHead>{t('Between')}</TableHead><TableHead>{t('Reason')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {pg.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell className="whitespace-nowrap">{stamp(r.createdAt)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.reporter?.name ?? 'Former user'} <span className="text-xs font-normal capitalize text-muted-foreground">({r.reporter?.role})</span></div>
                    <div className="text-xs text-muted-foreground">{t('reported')} {r.reported?.name ?? 'a former user'} <span className="capitalize">({r.reported?.role})</span></div>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal"><p className="line-clamp-2">{r.reason}</p></TableCell>
                  <TableCell><Badge variant={variant(r.status) as never} className="capitalize">{r.status}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline">{t('Open')}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager {...pg.props} />
        </>
      )}

      <ReportPanel reportId={openId} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); void load() }} />
    </div>
  )
}

function ReportPanel({ reportId, onClose, onChanged }: { reportId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useT()
  const [d, setD] = useState<Detail | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setD(null); setNote('')
    if (!reportId) return
    api<Detail>(`/messages/reports/${reportId}`).then(setD).catch((e) => { toast.error(e.message); onClose() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  const decide = async (s: 'reviewed' | 'dismissed') => {
    if (!d) return
    setBusy(true)
    try { await api(`/messages/reports/${d.id}`, { method: 'PUT', body: { status: s, note: note || undefined } }); toast.success(s === 'reviewed' ? 'Marked as reviewed' : 'Dismissed'); onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Sheet open={!!reportId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{t('Reported conversation')}</SheetTitle>
          <SheetDescription>{d ? `${d.reporter?.name ?? 'Someone'} reported ${d.reported?.name ?? 'someone'} on ${stamp(d.createdAt)}` : 'Loading…'}</SheetDescription>
        </SheetHeader>
        {d && (
          <>
            <div className="space-y-2 border-b p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Their reason')}</p>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3">{d.reason}</p>
              <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">{t('You are reading a private conversation because it was reported. This is recorded.')}</p>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {d.messages.map((m) => (
                <div key={m.id} className={`space-y-1 rounded-lg p-3 text-sm ${m.id === d.flaggedMessageId ? 'border border-destructive/60 bg-destructive/10' : 'bg-muted'}`}>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.senderName}</span> <span className="capitalize">({m.senderRole})</span> · {stamp(m.createdAt)}{m.edited ? ' · edited' : ''}{m.id === d.flaggedMessageId ? ' · reported message' : ''}</p>
                  {m.deleted ? <p className="italic text-muted-foreground">{t('Deleted by the sender')}</p> : m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  {m.attachments.map((f) => (
                    <button key={f.id} type="button" className="flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs hover:bg-accent" onClick={() => downloadFile(`/messages/attachments/${f.id}`, f.name).catch((e) => toast.error((e as Error).message))}><FileText className="h-3.5 w-3.5" /> {f.name}</button>
                  ))}
                </div>
              ))}
            </div>

            {d.status === 'open' ? (
              <div className="space-y-2 border-t p-3">
                <Textarea rows={2} maxLength={1000} placeholder={t('Note for the record (the person who reported sees it)')} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => decide('dismissed')}>{t('No action needed')}</Button>
                  <Button disabled={busy} onClick={() => decide('reviewed')}>{t('Mark reviewed')}</Button>
                </div>
              </div>
            ) : (
              <p className="border-t bg-muted/40 p-3 text-sm text-muted-foreground"><span className="capitalize">{d.status}</span>{d.reviewNote ? `: ${d.reviewNote}` : ''}</p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
