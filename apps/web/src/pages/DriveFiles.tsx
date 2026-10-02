import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Cloud, Download, File as FileIcon, FileText, Film, Loader2, Trash2, Upload, X } from 'lucide-react'
import { api, apiUrl, freshAccessToken, uploadFile } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { formatBytes } from '@/lib/bytes'
import { Button } from '@/components/ui/button'

interface DFile { id: string; name: string; mime: string; size: number; createdAt: string; uploadedBy: string; canDelete: boolean }
interface Listing { connected: boolean; canConnect: boolean; allowed: string; files: DFile[] }

const kind = (m: string) => (m.startsWith('image/') ? 'image' : m.startsWith('video/') ? 'video' : m === 'application/pdf' ? 'pdf' : 'other')

/** The file's bytes as a blob address. A plain <img> or <video> cannot send the sign-in header, so the page fetches it itself. */
async function fetchBlob(id: string): Promise<string> {
  const token = await freshAccessToken()
  const res = await fetch(apiUrl(`/api/drive/files/${id}`), { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(String(res.status))
  return URL.createObjectURL(await res.blob())
}

function Thumb({ f }: { f: DFile }) {
  const [src, setSrc] = useState<string | null>(null)
  const k = kind(f.mime)
  useEffect(() => {
    if (k !== 'image' || f.size > 10 * 1024 * 1024) return
    let live = true
    let url = ''
    fetchBlob(f.id).then((u) => { url = u; if (live) setSrc(u); else URL.revokeObjectURL(u) }).catch(() => undefined)
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [f.id, f.size, k])
  if (src) return <img src={src} alt={f.name} loading="lazy" className="size-full object-cover" />
  const Icon = k === 'video' ? Film : k === 'pdf' || f.mime.startsWith('text/') ? FileText : FileIcon
  return <Icon className="size-8 text-muted-foreground" aria-hidden />
}

function Viewer({ f, onClose }: { f: DFile; onClose: () => void }) {
  const { t } = useT()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const k = kind(f.mime)

  useEffect(() => {
    let live = true
    let url = ''
    if (k === 'other') return
    fetchBlob(f.id).then((u) => { url = u; if (live) setSrc(u); else URL.revokeObjectURL(u) }).catch(() => live && setFailed(true))
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [f.id, k])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const download = async () => {
    try {
      const token = await freshAccessToken()
      const res = await fetch(apiUrl(`/api/drive/files/${f.id}?download=1`), { headers: token ? { authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(t('Could not download the file'))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={f.name}>
      <div className="flex items-center justify-between gap-2 p-3 text-white">
        <p className="min-w-0 truncate font-medium">{f.name}</p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={download}><Download className="size-4" aria-hidden />{t('Download')}</Button>
          <Button size="icon" variant="secondary" onClick={onClose} aria-label={t('Close')}><X className="size-4" /></Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-3">
        {k === 'other' ? <p className="text-white/80">{t('This kind of file cannot be shown here. Use Download.')}</p>
          : failed ? <p className="text-white/80">{t('Could not open the file.')}</p>
          : !src ? <Loader2 className="size-8 animate-spin text-white/70" aria-label={t('Loading…')} />
          : k === 'image' ? <img src={src} alt={f.name} className="max-h-full max-w-full object-contain" />
          : k === 'video' ? <video src={src} controls autoPlay className="max-h-full max-w-full" />
          : <iframe src={src} title={f.name} sandbox="" className="size-full max-w-5xl bg-white" />}
      </div>
    </div>
  )
}

/** The school's Google Drive: photos, videos and documents. Open to every role except students and parents. */
export function DriveFiles() {
  const { t } = useT()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<DFile | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api<Listing>('/drive/files').then(setData).catch((e) => { setError(e.message); setData({ connected: false, canConnect: false, allowed: '', files: [] }) }), [])
  useEffect(() => { void load() }, [load])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    for (const f of Array.from(files)) {
      try { await uploadFile('/drive/files', f); toast.success(t('Uploaded {name}', { name: f.name })) }
      catch (e) { toast.error(`${f.name}: ${(e as Error).message}`) }
    }
    setBusy(false)
    if (input.current) input.current.value = ''
    await load()
  }
  const remove = async (f: DFile) => {
    if (!confirm(t('Delete "{name}" from Google Drive?', { name: f.name }))) return
    try { await api(`/drive/files/${f.id}`, { method: 'DELETE' }); await load() } catch (e) { toast.error((e as Error).message) }
  }

  if (!data) return <p className="text-muted-foreground">{t('Loading…')}</p>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Cloud className="size-6" aria-hidden />{t('Drive files')}</h1>
          <p className="text-sm text-muted-foreground">{t('Photos, videos and documents kept in the school\'s Google Drive. Visible to staff only, not to students or parents.')}</p>
        </div>
        {data.connected && (
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
            <Button onClick={() => input.current?.click()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}{busy ? t('Uploading…') : t('Upload files')}</Button>
          </>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{t('Could not load the files: {error}', { error })}</p>}

      {!data.connected ? (
        <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
          <Cloud className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('Google Drive is not connected yet')}</p>
          <p className="text-sm text-muted-foreground">{data.canConnect ? t('Connect it on the Storage page to start keeping files here.') : t('Ask the principal or admin to connect it on the Storage page.')}</p>
          {data.canConnect && <Button asChild><Link to="/storage">{t('Go to Storage')}</Link></Button>}
        </div>
      ) : data.files.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t('No files yet. Upload the first one.')}<br /><span className="text-xs">{data.allowed}</span></p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.files.map((f) => (
              <li key={f.id} className="overflow-hidden rounded-xl border bg-card">
                <button type="button" onClick={() => setOpen(f)} className="grid aspect-video w-full place-items-center overflow-hidden bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('Open {name}', { name: f.name })}><Thumb f={f} /></button>
                <div className="flex items-start justify-between gap-1 p-2">
                  <div className="min-w-0"><p className="truncate text-sm font-medium" title={f.name}>{f.name}</p><p className="truncate text-xs text-muted-foreground">{formatBytes(f.size)} · {f.uploadedBy}</p></div>
                  {f.canDelete && <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={t('Delete')} onClick={() => remove(f)}><Trash2 className="size-4" /></Button>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('Allowed: {types}. Up to 100 MB each.', { types: data.allowed })}</p>
        </>
      )}
      {open && <Viewer f={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
