import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Camera as CameraIcon, Expand, Maximize, Loader2, Pencil, Plus, Trash2, VideoOff } from 'lucide-react'
import Hls from 'hls.js'
import { api, apiUrl } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Cam { id: string; name: string; location: string; kind: 'hls' | 'mjpeg'; enabled: boolean; source?: string }
interface Draft { id?: string; name: string; location: string; kind: 'hls' | 'mjpeg'; sourceUrl: string; enabled: boolean }
const BLANK: Draft = { name: '', location: '', kind: 'hls', sourceUrl: '', enabled: true }
const RENEW_MS = 8 * 60_000 // viewing links last 10 minutes

/** One live picture. Asks the server for a viewing link, keeps it fresh, and plays through the server (never straight from the camera). */
function Feed({ cam, big }: { cam: Cam; big?: boolean }) {
  const { t } = useT()
  const video = useRef<HTMLVideoElement>(null)
  const token = useRef('')
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    let hls: Hls | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    setFailed(false); setSrc(null)
    api<{ token: string }>(`/cameras/${cam.id}/open`, { method: 'POST', body: { renew: false } })
      .then(({ token: tk }) => {
        if (!live) return
        token.current = tk
        timer = setInterval(() => { api<{ token: string }>(`/cameras/${cam.id}/open`, { method: 'POST', body: { renew: true } }).then((r) => { token.current = r.token }).catch(() => undefined) }, RENEW_MS)
        if (cam.kind === 'mjpeg') { setSrc(apiUrl(`/api/cameras/${cam.id}/mjpeg?t=${encodeURIComponent(tk)}`)); return }
        const el = video.current
        if (!el) return
        if (!Hls.isSupported()) { setFailed(true); return }
        hls = new Hls({ lowLatencyMode: true, xhrSetup: (xhr) => xhr.setRequestHeader('x-camera-token', token.current) })
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setFailed(true) })
        hls.loadSource(apiUrl(`/api/cameras/${cam.id}/hls/index.m3u8`))
        hls.attachMedia(el)
      })
      .catch((e) => { if (live) { setFailed(true); toast.error((e as Error).message) } })
    return () => { live = false; clearInterval(timer); hls?.destroy() }
  }, [cam.id, cam.kind])

  return (
    <div className={`relative aspect-video overflow-hidden rounded-lg bg-black ${big ? 'w-full' : ''}`}>
      {failed ? (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-sm text-white/80"><span><VideoOff className="mx-auto mb-1 size-6" aria-hidden />{t('No picture. Check the camera and its stream address.')}</span></div>
      ) : cam.kind === 'mjpeg' ? (
        src ? <img src={src} alt={cam.name} className="size-full object-contain" onError={() => setFailed(true)} /> : <Loader2 className="absolute inset-0 m-auto size-6 animate-spin text-white/70" aria-label={t('Loading…')} />
      ) : (
        <video ref={video} muted autoPlay playsInline controls={big} className="size-full object-contain" aria-label={cam.name} />
      )}
    </div>
  )
}


/** How the picture gets from a camera to the principal's screen. */
function ConnectionDiagram() {
  const { t } = useT()
  const sub = 'fill-muted-foreground text-[11px]'
  const node = (x: number, title: string, line1: string, line2: string, accent?: boolean) => (
    <g>
      <rect x={x} y={30} width={170} height={96} rx={12} className={accent ? 'fill-primary/10 stroke-primary' : 'fill-card stroke-border'} strokeWidth={1.5} />
      <text x={x + 85} y={62} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{title}</text>
      <text x={x + 85} y={84} textAnchor="middle" className={sub}>{line1}</text>
      <text x={x + 85} y={100} textAnchor="middle" className={sub}>{line2}</text>
    </g>
  )
  const arrow = (x: number, label: string, lock?: boolean) => (
    <g>
      <line x1={x} y1={78} x2={x + 60} y2={78} className="stroke-muted-foreground" strokeWidth={2} markerEnd="url(#arr)" />
      <text x={x + 30} y={66} textAnchor="middle" className={sub}>{label}</text>
      {lock && <text x={x + 30} y={98} textAnchor="middle" className={sub}>🔒</text>}
    </g>
  )
  return (
    <details open className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('How the cameras are connected')}</summary>
      <svg viewBox="0 0 880 150" className="mt-3 w-full" role="img" aria-label={t('Cameras connect to a gateway at school, which connects over the internet to the secure school server, which shows the video to a signed-in principal or admin.')}>
        <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" className="fill-muted-foreground" /></marker></defs>
        {node(0, t('Cameras'), t('At school'), t('Wi-Fi or cable'))}
        {arrow(170, 'RTSP')}
        {node(230, t('Gateway'), t('Small PC at school'), t('RTSP to HLS / MJPEG'))}
        {arrow(400, t('Internet'), true)}
        {node(460, t('Secure server'), t('Checks login and role'), t('Hides camera password'), true)}
        {arrow(630, 'HTTPS', true)}
        {node(690, t('Principal / Admin'), t('Signed-in browser'), t('Nobody else can open it'))}
      </svg>
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
        <li>{t('1. Cameras send video to the gateway inside the school network. They are never opened to the internet.')}</li>
        <li>{t('2. The gateway sends it to the secure server over an encrypted connection.')}</li>
        <li>{t('3. The server checks the person is a principal or admin, then relays the video to their browser.')}</li>
      </ul>
    </details>
  )
}

function Placeholders({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  const { t } = useT()
  return (
    <div className="space-y-3">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('Camera placeholders')}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <li key={n} className="rounded-xl border border-dashed bg-card/50 p-3">
            <div className="grid aspect-video place-items-center rounded-lg bg-muted/60 text-muted-foreground"><span className="text-center text-sm"><VideoOff className="mx-auto mb-1 size-6" aria-hidden />{t('Camera {n}', { n })}<br /><span className="text-xs">{t('Not connected')}</span></span></div>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-muted-foreground">{canManage ? t('Your cameras will appear here. Add the first one to get started.') : t('No cameras have been added yet.')}</p>
      {canManage && <div className="text-center"><Button onClick={onAdd}><Plus className="size-4" aria-hidden />{t('Add camera')}</Button></div>}
    </div>
  )
}

function Form({ draft, onSave, onCancel }: { draft: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const { t } = useT()
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const editing = !!d.id
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSave(d) } finally { setBusy(false) } }}
    >
      <h2 className="font-medium">{editing ? t('Edit camera') : t('Add a camera')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">{t('Name')}<Input required maxLength={80} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t('Main gate')} /></label>
        <label className="space-y-1 text-sm">{t('Location')}<Input maxLength={120} value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} placeholder={t('Entrance, ground floor')} /></label>
        <label className="space-y-1 text-sm">{t('Stream type')}
          <select className="h-9 w-full rounded-md border bg-background px-2" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Draft['kind'] })}>
            <option value="hls">HLS (.m3u8)</option>
            <option value="mjpeg">MJPEG</option>
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">{t('Stream address')}
          <Input type="url" required={!editing} value={d.sourceUrl} onChange={(e) => setD({ ...d, sourceUrl: e.target.value })} placeholder={editing ? t('Leave empty to keep the current address') : 'http://192.168.1.50:8888/gate/index.m3u8'} autoComplete="off" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("The address stays on the server. It may include the camera's password, and it is never sent to anyone's browser. Cameras that speak RTSP need a small gateway (go2rtc or MediaMTX) that turns them into HLS or MJPEG; see SERVICES.md.")}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />{t('Switched on')}</label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('Save')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t('Cancel')}</Button>
      </div>
    </form>
  )
}

/** Live school cameras. Principal and admin only: the server refuses everyone else, this page just does not offer it. */
export function Cameras() {
  const { t } = useT()
  const [cams, setCams] = useState<Cam[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [focus, setFocus] = useState<Cam | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api<{ canManage: boolean; cameras: Cam[] }>('/cameras').then((r) => { setCams(r.cameras); setCanManage(r.canManage) }).catch((e) => { setError(e.message); setCams([]) }), [])
  useEffect(() => { void load() }, [load])

  const save = async (d: Draft) => {
    try {
      const body = { name: d.name, location: d.location, kind: d.kind, enabled: d.enabled, ...(d.sourceUrl.trim() ? { sourceUrl: d.sourceUrl } : {}) }
      if (d.id) await api(`/cameras/${d.id}`, { method: 'PATCH', body }); else await api('/cameras', { body })
      toast.success(t('Saved')); setDraft(null); await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const remove = async (c: Cam) => {
    if (!confirm(t('Remove camera "{name}"?', { name: c.name }))) return
    try { await api(`/cameras/${c.id}`, { method: 'DELETE' }); if (focus?.id === c.id) setFocus(null); await load() } catch (e) { toast.error((e as Error).message) }
  }

  if (!cams) return <p className="text-muted-foreground">{t('Loading…')}</p>

  // Full screen view of one camera: the Back button at the top returns to the grid.
  if (focus) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => setFocus(null)}><ArrowLeft className="size-4" aria-hidden />{t('Back to all cameras')}</Button>
          <Button variant="outline" onClick={() => { void document.getElementById('cam-full')?.requestFullscreen?.() }}><Maximize className="size-4" aria-hidden />{t('Full screen')}</Button>
        </div>
        <div><h1 className="text-xl font-semibold">{focus.name}</h1>{focus.location && <p className="text-sm text-muted-foreground">{focus.location}</p>}</div>
        <div id="cam-full" className="mx-auto w-full max-w-6xl bg-black"><Feed cam={focus} big /></div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><CameraIcon className="size-6" aria-hidden />{t('School cameras')}</h1>
          <p className="text-sm text-muted-foreground">{t('Live view for the principal and admin only. Every time a camera is opened it is recorded in the audit log.')}</p>
        </div>
        {canManage && !draft && cams.length > 0 && <Button onClick={() => setDraft(BLANK)}><Plus className="size-4" aria-hidden />{t('Add camera')}</Button>}
      </div>

      <ConnectionDiagram />

      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{t('Could not load the cameras: {error}', { error })}</p>}

      {draft && <Form draft={draft} onSave={save} onCancel={() => setDraft(null)} />}

      {cams.length === 0 ? (
        <Placeholders canManage={canManage && !error} onAdd={() => setDraft(BLANK)} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cams.map((c) => (
            <li key={c.id} className="space-y-2 rounded-xl border bg-card p-3">
              {c.enabled ? (
                <button type="button" className="group relative block w-full text-left" onClick={() => setFocus(c)} aria-label={t('Open {name} full screen', { name: c.name })}>
                  <Feed cam={c} />
                  <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:opacity-100"><Expand className="size-8 text-white" aria-hidden /></span>
                </button>
              ) : <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">{t('Switched off')}</div>}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium">{c.name}</p>{c.location && <p className="truncate text-xs text-muted-foreground">{c.location}</p>}</div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="secondary">{c.kind.toUpperCase()}</Badge>
                  {canManage && <Button size="icon" variant="ghost" aria-label={t('Edit')} onClick={() => setDraft({ id: c.id, name: c.name, location: c.location, kind: c.kind, sourceUrl: '', enabled: c.enabled })}><Pencil className="size-4" /></Button>}
                  {canManage && <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => remove(c)}><Trash2 className="size-4" /></Button>}
                </div>
              </div>
              {canManage && c.source && <p className="truncate text-xs text-muted-foreground" title={c.source}>{c.source}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
