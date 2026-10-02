import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ArrowLeft, Ban, Bell, Check, CheckCheck, FileText, Flag, MessageSquarePlus, MoreHorizontal, Paperclip, Pencil, Search, Send, Trash2, X } from 'lucide-react'
import { api, downloadFile, uploadFile } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useMessages, type LiveMessage } from '@/lib/messages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/lib/i18n'

interface Person { id: string; name: string; role: string; context: string }
interface Conversation { id: string; other: Person; lastMessage: { body: string; mine: boolean; createdAt: string } | null; lastMessageAt: string; unread: number }
interface Attachment { id: string; name: string; size: number; mime: string }
interface Msg { id: string; body: string; deleted: boolean; edited: boolean; mine: boolean; senderId: string; createdAt: string; about: { id: string; name: string } | null; attachments: Attachment[] }
interface Thread { id: string; other: Person; canReply: boolean; blockedByMe: boolean; reported: boolean; otherReadAt: string | null; kids: { id: string; name: string }[]; messages: Msg[] }

const EDIT_WINDOW_MS = 15 * 60_000

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
const when = (iso: string) => {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const dayLabel = (iso: string) => {
  const d = new Date(iso), now = new Date(), y = new Date(now.getTime() - 86_400_000)
  return d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function Avatar({ name }: { name: string }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initials(name)}</span>
}

function FileChip({ file, mine }: { file: Attachment; mine: boolean }) {
  const { t } = useT()
  return (
    <button type="button" onClick={() => downloadFile(`/messages/attachments/${file.id}`, file.name).catch((e) => toast.error((e as Error).message))}
      className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition hover:opacity-90 ${mine ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'bg-background'}`}>
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="opacity-70">{t('{value} · tap to download', { value: size(file.size) })}</span></span>
    </button>
  )
}

/** Find someone to message. Only people you are allowed to message are listed. */
function NewMessage({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void }) {
  const { t: tr } = useT()
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  useEffect(() => {
    if (!open) return
    setPeople(null)
    const t = setTimeout(() => api<Person[]>(`/messages/contacts?q=${encodeURIComponent(q)}`).then(setPeople).catch(() => setPeople([])), 200)
    return () => clearTimeout(t)
  }, [q, open])
  useEffect(() => { if (!open) setQ('') }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('New message')}</DialogTitle>
          <DialogDescription>{tr('Choose who you want to write to.')}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={tr('Search by name')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {people === null && <p className="p-3 text-sm text-muted-foreground">{tr('Loading…')}</p>}
          {people?.length === 0 && <p className="p-3 text-sm text-muted-foreground">{q ? 'Nobody found.' : 'There is nobody you can message yet.'}</p>}
          {people?.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-accent">
              <Avatar name={p.name} />
              <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.context}</span></span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Tell the school about a problem. Filing one lets the principal read this conversation, and the person is told so up front. */
function ReportDialog({ target, onClose, onDone }: { target: { conversationId: string; messageId?: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useT()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (target) setReason('') }, [target])
  const submit = async () => {
    if (!target) return
    setBusy(true)
    try {
      await api(`/messages/conversations/${target.conversationId}/report`, { body: { reason, messageId: target.messageId } })
      toast.success(t('Reported. The school will look at it.'))
      onDone(); onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target?.messageId ? 'Report this message' : `Report the conversation with ${target?.name}`}</DialogTitle>
          <DialogDescription>{t('Tell us what is wrong. The person is not told who reported.')}</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} maxLength={1000} placeholder={t('What happened?')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {t('Reporting lets the school\'s reviewer read this conversation (the principal, or the admin if the principal is one of the two people). Nothing else of yours is opened. While it is open, messages here can\'t be edited or deleted.')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? 'Sending…' : 'Report'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ThreadView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { t: tr } = useT()
  const { user } = useAuth()
  const { onMessage, on, typing, refresh } = useMessages()
  const [thread, setThread] = useState<Thread | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [pending, setPending] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [about, setAbout] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [typingName, setTypingName] = useState('')
  const [report, setReport] = useState<{ conversationId: string; messageId?: string; name: string } | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // stay at the newest message unless the reader scrolled up
  const typedAt = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<Thread>(`/messages/conversations/${id}`).then((t) => { setThread(t); return t }), [id])

  useEffect(() => {
    let live = true
    setThread(null); setError(''); setPending([]); setEditing(null); setTypingName('')
    api<Thread>(`/messages/conversations/${id}`)
      .then((t) => { if (!live) return; setThread(t); setMore(t.messages.length >= 50); stick.current = true; setAbout(t.kids.length === 1 ? t.kids[0].id : ''); void refresh(); onChanged() })
      .catch((e: Error) => live && setError(e.message))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // New messages arrive live; if it is this conversation, show it and (if it is from them) mark it read.
  // The same event also echoes messages I send from another tab or device, which are shown as mine.
  useEffect(() => onMessage((m: LiveMessage) => {
    if (m.conversationId !== id) return
    const mine = m.message.senderId === user?.id
    setTypingName('')
    setThread((t) => (!t || t.messages.some((x) => x.id === m.message.id) ? t : { ...t, messages: [...t.messages, { deleted: false, edited: false, about: null, attachments: [], ...m.message, mine } as Msg] }))
    if (!mine) void api(`/messages/conversations/${id}/read`, { method: 'POST', body: {} }).then(refresh).catch(() => undefined)
  }), [id, user?.id, onMessage, refresh])

  // Edits, deletions, read receipts and "typing" from the other person.
  useEffect(() => {
    const offs = [
      on('dm:updated', (p: { conversationId: string; message: Msg }) => { if (p.conversationId === id) setThread((t) => t && { ...t, messages: t.messages.map((m) => (m.id === p.message.id ? { ...m, ...p.message } : m)) }) }),
      on('dm:deleted', (p: { conversationId: string; messageId: string }) => { if (p.conversationId === id) setThread((t) => t && { ...t, messages: t.messages.map((m) => (m.id === p.messageId ? { ...m, deleted: true, body: '', attachments: [] } : m)) }); void refresh(); onChanged() }),
      on('dm:read', (p: { conversationId: string; readAt: string }) => { if (p.conversationId === id) setThread((t) => t && { ...t, otherReadAt: p.readAt }) }),
      on('dm:typing', (p: { conversationId: string; name: string }) => { if (p.conversationId === id) setTypingName(p.name) }),
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, on])
  useEffect(() => { if (!typingName) return; const t = setTimeout(() => setTypingName(''), 4000); return () => clearTimeout(t) }, [typingName])

  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [thread?.messages.length, typingName])

  const loadEarlier = async () => {
    const first = thread?.messages[0]
    if (!first) return
    stick.current = false
    const r = await api<Thread>(`/messages/conversations/${id}?before=${encodeURIComponent(first.createdAt)}`)
    setThread((t) => (t ? { ...t, messages: [...r.messages, ...t.messages] } : t))
    setMore(r.messages.length >= 50)
  }

  const onType = (v: string) => {
    setText(v)
    const now = Date.now()
    if (v && now - typedAt.current > 2500) { typedAt.current = now; typing(id) }
  }

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    for (const f of files) {
      try { const a = await uploadFile<Attachment>(`/messages/conversations/${id}/attachments`, f); setPending((p) => [...p, a]) }
      catch (err) { toast.error(`${f.name}: ${(err as Error).message}`) }
    }
    setUploading(false)
  }
  const drop = async (a: Attachment) => {
    setPending((p) => p.filter((x) => x.id !== a.id))
    await api(`/messages/attachments/${a.id}`, { method: 'DELETE' }).catch(() => undefined)
  }

  const needsChild = (thread?.kids.length ?? 0) > 1 && user?.role === 'parent' && !about
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if ((!body && pending.length === 0) || busy || uploading) return
    if (needsChild) return toast.error(tr('Choose which child this message is about'))
    setBusy(true)
    try {
      const m = await api<Msg>(`/messages/conversations/${id}`, { body: { body, attachmentIds: pending.map((p) => p.id), aboutStudentId: about || undefined } })
      stick.current = true
      setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t))
      setText(''); setPending([]); onChanged()
    } catch (err) {
      toast.error((err as Error).message)
      if (/no longer/i.test((err as Error).message)) setThread((t) => (t ? { ...t, canReply: false } : t))
    } finally { setBusy(false) }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }

  const saveEdit = async () => {
    if (!editing || !editing.text.trim()) return
    try {
      const m = await api<Msg>(`/messages/message/${editing.id}`, { method: 'PUT', body: { body: editing.text } })
      setThread((t) => t && { ...t, messages: t.messages.map((x) => (x.id === m.id ? { ...x, ...m } : x)) })
      setEditing(null); onChanged()
    } catch (err) { toast.error((err as Error).message) }
  }
  const remove = async (m: Msg) => {
    if (!window.confirm(tr('Delete this message for both of you? This cannot be undone.'))) return
    try { await api(`/messages/message/${m.id}`, { method: 'DELETE' }); setThread((t) => t && { ...t, messages: t.messages.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', attachments: [] } : x)) }); onChanged() }
    catch (err) { toast.error((err as Error).message) }
  }

  const block = async () => {
    if (!thread || !window.confirm(`Block ${thread.other.name}? Neither of you will be able to send messages until you unblock.`)) return
    try { await api('/messages/blocks', { body: { userId: thread.other.id } }); await load(); onChanged(); toast.success(`${thread.other.name} is blocked`) }
    catch (err) { toast.error((err as Error).message) }
  }
  const unblock = async () => {
    if (!thread) return
    try { await api(`/messages/blocks/${thread.other.id}`, { method: 'DELETE' }); await load(); onChanged(); toast.success(tr('Unblocked')) }
    catch (err) { toast.error((err as Error).message) }
  }

  if (error) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><p>{error}</p><Button variant="outline" size="sm" onClick={onBack}>{tr('Back to messages')}</Button></div>
  if (!thread) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{tr('Loading…')}</div>

  const lastMine = [...thread.messages].reverse().find((m) => m.mine && !m.deleted)
  const seen = (m: Msg) => !!thread.otherReadAt && new Date(thread.otherReadAt).getTime() >= new Date(m.createdAt).getTime()
  const canEdit = (m: Msg) => m.mine && !m.deleted && !thread.reported && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS && thread.canReply

  let lastDay = ''
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b p-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={tr('Back to messages')}><ArrowLeft className="h-5 w-5" /></Button>
        <Avatar name={thread.other.name} />
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{thread.other.name}</p><p className="truncate text-xs text-muted-foreground">{typingName ? <span className="text-primary">{tr('typing…')}</span> : thread.other.context}</p></div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={tr('Conversation options')}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setReport({ conversationId: id, name: thread.other.name })}><Flag className="h-4 w-4" /> {tr('Report conversation')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            {thread.blockedByMe
              ? <DropdownMenuItem onSelect={unblock}><Check className="h-4 w-4" /> Unblock {thread.other.name.split(' ')[0]}</DropdownMenuItem>
              : !['principal', 'admin'].includes(thread.other.role) && <DropdownMenuItem variant="destructive" onSelect={block}><Ban className="h-4 w-4" /> Block {thread.other.name.split(' ')[0]}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {thread.reported && <p className="border-b bg-amber-500/10 px-4 py-2 text-xs">{tr('This conversation has been reported and can be reviewed by the school. Messages in it can\'t be edited or deleted for now.')}</p>}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {more && <div className="text-center"><Button variant="ghost" size="sm" onClick={loadEarlier}>{tr('Load earlier messages')}</Button></div>}
        {thread.messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{tr('No messages yet. Say hello to {value}.', { value: thread.other.name.split(' ')[0] })}</p>}
        {thread.messages.map((m) => {
          const day = dayLabel(m.createdAt), showDay = day !== lastDay
          lastDay = day
          const isEditing = editing?.id === m.id
          return (
            <div key={m.id}>
              {showDay && <p className="my-3 text-center text-xs text-muted-foreground">{day}</p>}
              <div className={`group flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
                {m.about && <span className="mb-0.5 text-[11px] text-muted-foreground">{tr('About')} <span className="font-medium text-foreground">{m.about.name}</span></span>}
                <div className={`flex max-w-[88%] items-start gap-1 ${m.mine ? 'flex-row-reverse' : ''}`}>
                  {isEditing ? (
                    <div className="w-full min-w-64 space-y-2 rounded-2xl border bg-background p-2">
                      <Textarea rows={2} value={editing.text} maxLength={2000} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit() } if (e.key === 'Escape') setEditing(null) }} />
                      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tr('Cancel')}</Button><Button size="sm" onClick={saveEdit} disabled={!editing.text.trim()}>{tr('Save')}</Button></div>
                    </div>
                  ) : (
                    <div className={`min-w-0 space-y-1.5 rounded-2xl px-3 py-2 text-sm ${m.mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted'}`}>
                      {m.deleted ? <p className="italic opacity-70">{tr('This message was deleted')}</p> : m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {m.attachments.map((f) => <FileChip key={f.id} file={f} mine={m.mine} />)}
                    </div>
                  )}
                  {!isEditing && !m.deleted && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100 focus:opacity-100 max-md:opacity-60" aria-label={tr('Message options')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align={m.mine ? 'end' : 'start'} className="w-44">
                        {m.mine ? (
                          <>
                            {canEdit(m) && m.body && <DropdownMenuItem onSelect={() => setEditing({ id: m.id, text: m.body })}><Pencil className="h-4 w-4" /> {tr('Edit')}</DropdownMenuItem>}
                            {!thread.reported && <DropdownMenuItem variant="destructive" onSelect={() => remove(m)}><Trash2 className="h-4 w-4" /> {tr('Delete')}</DropdownMenuItem>}
                            {thread.reported && <DropdownMenuItem disabled>{tr('Under review')}</DropdownMenuItem>}
                          </>
                        ) : (
                          <DropdownMenuItem onSelect={() => setReport({ conversationId: id, messageId: m.id, name: thread.other.name })}><Flag className="h-4 w-4" /> {tr('Report message')}</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {m.edited && <span>{tr('· edited')}</span>}
                  {m.mine && m.id === lastMine?.id && (seen(m) ? <span className="flex items-center gap-0.5 text-primary"><CheckCheck className="h-3.5 w-3.5" /> {tr('Seen')}</span> : <span className="flex items-center gap-0.5"><Check className="h-3.5 w-3.5" /> {tr('Sent')}</span>)}
                </span>
              </div>
            </div>
          )
        })}
        {typingName && <p className="text-xs italic text-muted-foreground">{tr('{value} is typing…', { value: typingName.split(' ')[0] })}</p>}
        <div ref={bottom} />
      </div>

      {thread.canReply ? (
        <form onSubmit={send} className="space-y-2 border-t p-3">
          {(pending.length > 0 || uploading) && (
            <div className="flex flex-wrap gap-2">
              {pending.map((a) => (
                <span key={a.id} className="flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{a.name}</span><button type="button" onClick={() => drop(a)} aria-label={`Remove ${a.name}`}><X className="h-3.5 w-3.5" /></button></span>
              ))}
              {uploading && <span className="px-2 py-1 text-xs text-muted-foreground">{tr('Uploading…')}</span>}
            </div>
          )}
          {thread.kids.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {tr('About')}<select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground" value={about} onChange={(e) => setAbout(e.target.value)} aria-label={tr('Which child is this about')}>
                {(thread.kids.length > 1 || user?.role !== 'parent') && <option value="">{user?.role === 'parent' ? 'Choose a child…' : 'No particular child'}</option>}
                {thread.kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInput} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt" onChange={pick} />
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} disabled={uploading || pending.length >= 5} aria-label={tr('Attach a file')} title={tr('Attach a file (PDF, image, Word, text; up to 100 MB)')}><Paperclip className="h-5 w-5" /></Button>
            <Textarea rows={1} value={text} maxLength={2000} onChange={(e) => onType(e.target.value)} onKeyDown={onKey} placeholder={`Message ${thread.other.name.split(' ')[0]}…`} className="max-h-32 min-h-10 resize-none" aria-label={tr('Message')} />
            <Button type="submit" size="icon" disabled={(!text.trim() && pending.length === 0) || busy || uploading} aria-label={tr('Send')}><Send className="h-4 w-4" /></Button>
          </div>
        </form>
      ) : thread.blockedByMe ? (
        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 p-3 text-sm text-muted-foreground"><span>{tr('You blocked {name}. Unblock to message again.', { name: thread.other.name })}</span><Button size="sm" variant="outline" onClick={unblock}>{tr('Unblock')}</Button></div>
      ) : (
        <p className="border-t bg-muted/40 p-3 text-center text-sm text-muted-foreground">{tr('You can no longer message this person. You can still read this conversation.')}</p>
      )}

      <ReportDialog target={report} onClose={() => setReport(null)} onDone={() => setThread((t) => (t ? { ...t, reported: true } : t))} />
    </div>
  )
}

export default function Messages() {
  const { t } = useT()
  const [sp, setSp] = useSearchParams()
  const active = sp.get('c')
  const { onMessage, on } = useMessages()
  const [list, setList] = useState<Conversation[] | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const load = useCallback(() => api<Conversation[]>('/messages/conversations').then(setList).catch(() => setList([])), [])
  useEffect(() => { void load() }, [load])
  useEffect(() => onMessage(() => { void load() }), [onMessage, load]) // keep the list and previews current
  useEffect(() => on('dm:deleted', () => { void load() }), [on, load])

  const openConversation = (id: string | null) => { const n = new URLSearchParams(sp); id ? n.set('c', id) : n.delete('c'); setSp(n, { replace: false }) }
  const startWith = async (userId: string) => {
    try { const r = await api<{ id: string }>('/messages/conversations', { body: { userId } }); setNewOpen(false); await load(); openConversation(r.id) }
    catch (err) { toast.error((err as Error).message) }
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[26rem] overflow-hidden rounded-xl border bg-card">
      {/* Conversation list: hidden on phones while a conversation is open */}
      <aside className={`${active ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r md:w-80`}>
        <div className="flex items-center justify-between border-b p-3">
          <h1 className="text-lg font-semibold">{t('Messages')}</h1>
          <div className="flex items-center gap-1">
            <Button asChild size="icon" variant="ghost" title={t('Notifications')} aria-label={t('Notifications')}><Link to="/notifications"><Bell className="h-4 w-4" /></Link></Button>
            <Button size="sm" onClick={() => setNewOpen(true)}><MessageSquarePlus className="mr-1 h-4 w-4" /> {t('New')}</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list === null && <p className="p-4 text-sm text-muted-foreground">{t('Loading…')}</p>}
          {list?.length === 0 && (
            <div className="space-y-3 p-6 text-center text-sm text-muted-foreground">
              <p>{t('No conversations yet.')}</p>
              <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>{t('Start one')}</Button>
            </div>
          )}
          {list?.map((c) => (
            <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`flex w-full items-center gap-3 border-b p-3 text-left transition hover:bg-accent/60 ${active === c.id ? 'bg-accent' : ''}`}>
              <Avatar name={c.other.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.other.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{c.lastMessage ? when(c.lastMessage.createdAt) : ''}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{c.other.context}</span>
                <span className={`block truncate text-sm ${c.unread ? 'text-foreground' : 'text-muted-foreground'}`}>{c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'}</span>
              </span>
              {c.unread > 0 && <Badge className="shrink-0">{c.unread}</Badge>}
            </button>
          ))}
        </div>
      </aside>

      <section className={`${active ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {active ? (
          <ThreadView key={active} id={active} onBack={() => openConversation(null)} onChanged={load} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageSquarePlus className="h-8 w-8" />
            <p>{t('Choose a conversation, or start a new one.')}</p>
          </div>
        )}
      </section>

      <NewMessage open={newOpen} onOpenChange={setNewOpen} onPick={startWith} />
    </div>
  )
}
