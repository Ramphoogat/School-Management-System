import { useEffect, useState, type FormEvent } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface ImportSources {
  canUseLinks: boolean
  maxMb: number
  allowed: string
  driveConnected: boolean
  shareWith: string | null
  sources: { id: string; name: string; example: string; how: string }[]
  notSupported: string[]
}

/** The "?" button: shows which places a link can come from, and how to get a link that works. The list comes from the server. */
export function SourceHelp({ className = '' }: { className?: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<ImportSources | null>(null)
  useEffect(() => {
    if (open && !info) api<ImportSources>('/import/sources').then(setInfo).catch((e) => toast.error(e.message))
  }, [open, info])

  return (
    <>
      <Button
        type="button" variant="outline" size="icon" className={`size-7 shrink-0 rounded-full text-sm font-semibold ${className}`}
        aria-label={t('Which links can I use?')} title={t('Which links can I use?')} aria-haspopup="dialog" onClick={() => setOpen(true)}
      >?</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Which links can I use?')}</DialogTitle>
            <DialogDescription>
              {info ? t('Paste a link and the school fetches the file for you. Files up to {mb} MB; {types}.', { mb: info.maxMb, types: info.allowed }) : t('Loading…')}
            </DialogDescription>
          </DialogHeader>
          {info && (
            <div className="space-y-4 text-sm">
              <ul className="space-y-3">
                {info.sources.map((s) => (
                  <li key={s.id} className="rounded-lg border p-3">
                    <p className="font-medium">{s.name}</p>
                    <p className="mt-1 text-muted-foreground">{s.how}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{s.example}</p>
                  </li>
                ))}
              </ul>
              {info.driveConnected && info.shareWith && (
                <p className="rounded-lg bg-muted/60 p-3">
                  {t('A private Google Drive file can be read too: share it (as Viewer) with')} <strong className="break-all">{info.shareWith}</strong>.
                </p>
              )}
              <div>
                <p className="font-medium">{t('What does not work')}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {info.notSupported.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>
              {!info.canUseLinks && <p className="text-muted-foreground">{t('Students upload files from their own device.')}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * A "From a link" button for a place that takes uploaded files. It asks for a link and sends it to the same address an upload
 * would go to; the server fetches the file and stores it exactly as if it had been uploaded. Not shown to students.
 */
export function AddFromLink({ path, extra, withTitle, label, onDone, variant = 'outline' }: {
  path: string
  /** Any other fields the place needs, sent along with the link. */
  extra?: Record<string, string>
  /** Offer an optional title field (school documents). */
  withTitle?: boolean
  label?: string
  onDone: () => void
  variant?: 'outline' | 'default' | 'ghost'
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = (o: boolean) => { if (!busy) { setOpen(o); if (!o) setError('') } }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api(path, { body: { ...extra, ...(withTitle && title.trim() ? { title: title.trim() } : {}), url: url.trim() } })
      toast.success(t('File added from the link'))
      setUrl(''); setTitle(''); setOpen(false)
      onDone()
    } catch (err) {
      setError((err as Error).message) // stays in the dialog, so the person can fix the link
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button type="button" size="sm" variant={variant} className="gap-1.5" onClick={() => setOpen(true)}>
        <Link2 className="size-4" aria-hidden />{label ?? t('From a link')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{t('Add a file from a link')}</DialogTitle>
              <SourceHelp />
            </div>
            <DialogDescription>{t('Paste a link from Google Drive, Dropbox, OneDrive, GitHub or any direct file link. Press ? to see which links work.')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Input type="url" inputMode="url" placeholder="https://…" aria-label={t('Link')} value={url} onChange={(e) => setUrl(e.target.value)} required autoFocus />
            {withTitle && <Input placeholder={t('Title (optional)')} aria-label={t('Title')} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
            {error && <p role="alert" className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>{t('Cancel')}</Button>
              <Button type="submit" disabled={busy || !url.trim()} className="gap-1.5">
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{busy ? t('Fetching…') : t('Add file')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
