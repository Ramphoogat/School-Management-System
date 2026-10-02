import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BookMarked, BookOpen, Download, Library, Lock, Plus, ShieldOff, Trash2, Upload, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, fetchBlob, downloadFile, uploadForm } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SourceHelp } from '@/components/LinkImport'

interface Book {
  id: string; title: string; author: string | null; description: string | null; name: string; mime: string; size: number
  createdAt: string; addedBy: string; revoked?: boolean; revokedCount?: number
}
interface BookList { canAdd: boolean; canRevoke: boolean; max: number; books: Book[] }
interface AccessRow { id: string; name: string; revoked: boolean; reason: string | null; since: string | null }

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const kind = (b: Pick<Book, 'mime' | 'name'>) => (b.mime === 'application/pdf' ? 'PDF' : b.mime.startsWith('image/') ? 'IMAGE' : /\.docx?$/i.test(b.name) ? 'WORD' : 'TEXT')

/** Each book gets its own cover colour, always the same one for the same title. */
const COVERS = [
  'from-sky-500 to-indigo-600', 'from-emerald-500 to-teal-700', 'from-rose-500 to-fuchsia-700', 'from-amber-500 to-orange-700',
  'from-violet-500 to-purple-700', 'from-cyan-500 to-blue-700', 'from-lime-600 to-green-800', 'from-pink-500 to-red-700',
]
const coverOf = (title: string) => COVERS[[...title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % COVERS.length]

/** Opens the book from a copy fetched with the person's sign-in (a plain link could not carry it). PDFs and pictures open in a tab; others download. */
async function openBook(b: Book) {
  if (b.mime !== 'application/pdf' && !b.mime.startsWith('image/')) return downloadFile(`/books/files/${b.id}`, b.name)
  const blob = await fetchBlob(`/books/files/${b.id}`)
  const url = URL.createObjectURL(new Blob([blob], { type: b.mime }))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function Cover({ b, locked }: { b: Book; locked?: boolean }) {
  return (
    <div className={`relative flex aspect-[4/3] items-end overflow-hidden rounded-t-xl bg-gradient-to-br p-4 text-white ${locked ? 'from-zinc-400 to-zinc-600 grayscale' : coverOf(b.title)}`} aria-hidden>
      <BookOpen className="absolute -right-4 -top-4 size-28 rotate-12 opacity-15" />
      <span className="absolute left-3 top-3 rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider">{kind(b)}</span>
      {locked && <Lock className="absolute right-3 top-3 size-5" />}
      <span className="line-clamp-3 text-lg font-semibold leading-tight drop-shadow">{b.title}</span>
    </div>
  )
}

/** Principal and admin: who can use this book, and the buttons to withdraw it from one student or give it back. */
function AccessDialog({ book, onClose, onChanged }: { book: Book; onClose: () => void; onChanged: () => void }) {
  const { t } = useT()
  const [rows, setRows] = useState<AccessRow[] | null>(null)
  const [reason, setReason] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => api<{ students: AccessRow[] }>(`/books/${book.id}/access`).then((r) => setRows(r.students)).catch((e) => toast.error(e.message)), [book.id])
  useEffect(() => { void load() }, [load])

  const change = async (s: AccessRow) => {
    setBusy(s.id)
    try {
      await api(`/books/${book.id}/${s.revoked ? 'restore' : 'revoke'}`, { body: s.revoked ? { studentId: s.id } : { studentId: s.id, reason: reason[s.id] || undefined } })
      toast.success(s.revoked ? t('{name} can use this book again', { name: s.name }) : t('{name} can no longer use this book', { name: s.name }))
      await load(); onChanged()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Who can use this book')}</DialogTitle>
          <DialogDescription>{book.title}. {t('Withdrawing it stops one student from opening it. Everyone else keeps it.')}</DialogDescription>
        </DialogHeader>
        {!rows ? <p className="text-sm text-muted-foreground">{t('Loading…')}</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('This class has no students yet.')}</p> : (
          <ul className="max-h-[55dvh] divide-y overflow-y-auto rounded-lg border">
            {rows.map((s) => (
              <li key={s.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                  {s.revoked && <Badge variant="destructive" className="gap-1"><Lock className="size-3" />{t('Withdrawn')}</Badge>}
                  <Button size="sm" variant={s.revoked ? 'outline' : 'ghost'} className="gap-1.5" disabled={busy === s.id} onClick={() => change(s)}>
                    {s.revoked ? <><UserCheck className="size-3.5" />{t('Give back')}</> : <><ShieldOff className="size-3.5" />{t('Withdraw')}</>}
                  </Button>
                </div>
                {s.revoked
                  ? s.reason && <p className="text-xs text-muted-foreground">{t('Reason: {reason}', { reason: s.reason })}</p>
                  : <Input placeholder={t('Reason (optional)')} aria-label={t('Reason for withdrawing the book from {name}', { name: s.name })} maxLength={300} value={reason[s.id] ?? ''} onChange={(e) => setReason((r) => ({ ...r, [s.id]: e.target.value }))} className="h-8 text-xs" />}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddBook({ classId, max, onDone }: { classId: string; max: number; onDone: () => void }) {
  const { t } = useT()
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  /** Where the book comes from: a file on this device, or a link (Google Drive, Dropbox, OneDrive, a direct link). */
  const [source, setSource] = useState<'device' | 'link'>('device')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const ready = source === 'device' ? !!file : !!url.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      if (source === 'device') await uploadForm(`/books/class/${classId}`, file!, { title, author, description })
      else await api(`/books/class/${classId}`, { body: { title, ...(author ? { author } : {}), ...(description ? { description } : {}), url: url.trim() } })
      toast.success(t('Book added'))
      setTitle(''); setAuthor(''); setDescription(''); setFile(null); setUrl('')
      if (input.current) input.current.value = ''
      onDone()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-5" aria-label={t('Add a book')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder={t('Book title')} aria-label={t('Book title')} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
        <Input placeholder={t('Author (optional)')} aria-label={t('Author')} value={author} maxLength={80} onChange={(e) => setAuthor(e.target.value)} />
      </div>
      <Textarea rows={2} placeholder={t('What is it for? For example “Chapters 1 to 5, term 1”')} aria-label={t('Description')} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('Where is the book?')}>
        <Button type="button" size="sm" variant={source === 'device' ? 'default' : 'outline'} aria-pressed={source === 'device'} onClick={() => setSource('device')}>{t('From this device')}</Button>
        <Button type="button" size="sm" variant={source === 'link' ? 'default' : 'outline'} aria-pressed={source === 'link'} onClick={() => setSource('link')}>{t('From a link')}</Button>
        {source === 'link' && <SourceHelp />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {source === 'device' ? (
          <>
            <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => input.current?.click()}><Upload className="size-4" />{file ? t('Choose another file') : t('Choose the book file')}</Button>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{file ? `${file.name} · ${kb(file.size)}` : t('PDF, Word, text or pictures, up to 100 MB')}</span>
          </>
        ) : (
          <Input type="url" inputMode="url" className="min-w-0 flex-1 basis-60" placeholder={t('Paste the link to the book (Google Drive, Dropbox, OneDrive…)')} aria-label={t('Link to the book')} value={url} onChange={(e) => setUrl(e.target.value)} />
        )}
        <Button type="submit" disabled={busy || !ready || !title.trim()}>{busy ? t('Adding…') : t('Add book')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('Up to {max} books per class. Students of this class can read what you add here.', { max })}</p>
    </form>
  )
}

/** A class's books. Staff add them; the class's students read them; the principal or admin can withdraw one book from one student. */
export function Books({ classId }: { classId: string }) {
  const { t } = useT()
  const [data, setData] = useState<BookList | null>(null)
  const [adding, setAdding] = useState(false)
  const [access, setAccess] = useState<Book | null>(null)

  const load = useCallback(() => api<BookList>(`/books/class/${classId}`).then(setData).catch((e) => { toast.error(e.message); setData({ canAdd: false, canRevoke: false, max: 0, books: [] }) }), [classId])
  useEffect(() => { void load() }, [load])

  const remove = async (b: Book) => {
    if (!window.confirm(t('Remove “{title}” for the whole class?', { title: b.title }))) return
    try { await api(`/books/${b.id}`, { method: 'DELETE' }); toast.success(t('Book removed')); await load() } catch (e) { toast.error((e as Error).message) }
  }

  if (!data) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Library className="size-4" aria-hidden />{data.books.length === 0 ? t('No books yet.') : t('{n} book(s) in this class', { n: data.books.length })}</p>
        {data.canAdd && (
          <Button size="sm" className="gap-1.5" variant={adding ? 'outline' : 'default'} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus className={`size-4 transition-transform ${adding ? 'rotate-45' : ''}`} aria-hidden />{adding ? t('Cancel') : t('Add a book')}
          </Button>
        )}
      </div>

      {data.canAdd && adding && <AddBook classId={classId} max={data.max} onDone={() => { setAdding(false); void load() }} />}

      {data.books.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <BookMarked className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('No books yet.')}</p>
          <p className="text-sm text-muted-foreground">{data.canAdd ? t('Use “Add a book” to share the first one with this class.') : t('Books your school shares with this class will appear here.')}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {data.books.map((b) => {
            const locked = !!b.revoked
            return (
              <li key={b.id} className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
                <Cover b={b} locked={locked} />
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div>
                    <h3 className="font-semibold leading-snug">{b.title}</h3>
                    {b.author && <p className="text-sm text-muted-foreground">{t('by {author}', { author: b.author })}</p>}
                  </div>
                  {b.description && <p className="line-clamp-3 text-sm text-muted-foreground">{b.description}</p>}
                  <p className="text-xs text-muted-foreground">{kind(b)} · {kb(b.size)} · {t('Added by {name}', { name: b.addedBy })} · {new Date(b.createdAt).toLocaleDateString()}</p>
                  {data.canRevoke && !!b.revokedCount && <Badge variant="outline" className="w-fit gap-1 text-destructive"><Lock className="size-3" />{t('Withdrawn from {n} student(s)', { n: b.revokedCount })}</Badge>}

                  {locked ? (
                    <p role="status" className="mt-auto flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />{t('Your school has withdrawn this book from you. Ask your teacher or the school office if you think this is a mistake.')}
                    </p>
                  ) : (
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      <Button size="sm" className="gap-1.5" onClick={() => openBook(b).catch((e) => toast.error(e.message))}><BookOpen className="size-4" />{t('Read')}</Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`/books/files/${b.id}`, b.name).catch((e) => toast.error(e.message))}><Download className="size-4" />{t('Download')}</Button>
                    </div>
                  )}

                  {(data.canRevoke || data.canAdd) && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      {data.canRevoke && <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setAccess(b)}><ShieldOff className="size-4" />{t('Who can use it')}</Button>}
                      {data.canAdd && <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" aria-label={t('Remove {title}', { title: b.title })} onClick={() => remove(b)}><Trash2 className="size-4" />{t('Remove')}</Button>}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {access && <AccessDialog book={access} onClose={() => setAccess(null)} onChanged={() => void load()} />}
    </div>
  )
}
