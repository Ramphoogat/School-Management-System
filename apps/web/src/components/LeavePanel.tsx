import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useT } from '@/lib/i18n'

interface Msg { id: string; authorId: string; authorName: string; authorRole?: string; body: string; createdAt: string }
interface Detail {
  id: string; subjectName: string; subjectRole?: string; requesterId: string; subjectUserId: string; requesterName: string
  fromDate: string; toDate: string; reason: string; status: string; decisionNote?: string | null; messages: Msg[]
}

const variant = (s: string) => (s === 'rejected' ? 'destructive' : s === 'approved' ? 'default' : 'secondary')
const when = (d: string) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Right-hand panel for one leave request: why it was asked for, and the conversation around it. */
export function LeavePanel({ leaveId, onClose, onDecide }: { leaveId: string | null; onClose: () => void; onDecide?: (id: string, d: 'approve' | 'reject') => void }) {
  const { t: tr } = useT()
  const { user, can } = useAuth()
  const [d, setD] = useState<Detail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    if (!leaveId) return
    api<Detail>(`/leave/${leaveId}`).then(setD).catch((e) => toast.error(e.message))
  }, [leaveId])

  useEffect(() => {
    setD(null); setText('')
    if (!leaveId) return
    load()
    const t = setInterval(load, 8000) // pick up replies while the panel is open
    return () => clearInterval(t)
  }, [leaveId, load])

  const count = d?.messages.length ?? 0
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [count])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!d || !text.trim()) return
    setBusy(true)
    try {
      const messages = await api<Msg[]>(`/leave/${d.id}/messages`, { body: { body: text.trim() } })
      setD({ ...d, messages }); setText('')
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const range = d ? (d.fromDate === d.toDate ? d.fromDate : `${d.fromDate} to ${d.toDate}`) : ''
  const canDecide = d?.status === 'pending' && can('leave', 'approve') && !!onDecide

  return (
    <Sheet open={!!leaveId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{tr('Leave request')}</SheetTitle>
          <SheetDescription>{d ? `${d.subjectName} · ${range}` : 'Loading…'}</SheetDescription>
        </SheetHeader>

        {d && (
          <>
            <div className="space-y-3 border-b p-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={variant(d.status) as never} className="capitalize">{d.status}</Badge>
                <span className="capitalize text-muted-foreground">{d.subjectRole}{d.requesterId !== d.subjectUserId ? ` · asked by ${d.requesterName}` : ''}</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Why they need leave')}</p>
                <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-muted p-3">{d.reason}</p>
              </div>
              {d.decisionNote && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('Decision note')}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{d.decisionNote}</p>
                </div>
              )}
              {canDecide && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onDecide!(d.id, 'approve')}>{tr('Approve')}</Button>
                  <Button size="sm" variant="destructive" onClick={() => onDecide!(d.id, 'reject')}>{tr('Reject')}</Button>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {d.messages.length === 0 && <p className="text-center text-sm text-muted-foreground">{tr('No messages yet. Ask a question or add details here.')}</p>}
              {d.messages.map((m) => {
                const mine = m.authorId === user?.id
                return (
                  <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <span className="text-xs text-muted-foreground">{mine ? 'You' : m.authorName}{!mine && m.authorRole ? ` (${m.authorRole})` : ''} · {when(m.createdAt)}</span>
                    <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{m.body}</p>
                  </div>
                )
              })}
              <div ref={bottom} />
            </div>

            <form onSubmit={send} className="flex items-end gap-2 border-t p-3">
              <Textarea
                rows={2} maxLength={2000} placeholder={tr('Write a message…')} value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
                className="min-h-0 resize-none"
              />
              <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label={tr('Send')}><Send className="h-4 w-4" /></Button>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
