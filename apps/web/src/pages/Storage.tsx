import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Cloud, ExternalLink, Link2Off, HardDrive, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { formatBytes } from '@/lib/bytes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Mode = 'auto' | 'primary' | 'drive'
type Reason = 'drive-not-set-up' | 'chosen-main' | 'chosen-drive' | 'auto-main' | 'auto-main-full'

interface Status {
  mode: Mode
  activeNow: 'primary' | 'drive'
  reason: Reason
  main: { kind: 's3' | 'disk'; provider: 'cloudflare-r2' | 'amazon-s3' | 's3-compatible' | 'disk'; bucket: string | null; endpointHost: string | null; disk: { freeBytes: number; totalBytes: number } | null; usedBytes: number; limitBytes: number | null; schoolBytes: number; schoolFiles: number }
  drive: {
    source: 'connected' | 'server' | null; canConnect: boolean; folderUrl: string | null
    configured: boolean; shareWith: string | null; usedBytes: number; schoolBytes: number; schoolFiles: number
    account: string | null; quotaLimitBytes: number | null; quotaUsedBytes: number | null; error: string | null
  }
}
interface Step { step: string; ok: boolean; ms: number; error?: string }
interface CheckResult { main: { kind: string; steps: Step[] }; drive: { steps: Step[] } | null }

function Bar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{formatBytes(used)}{limit ? ` of ${formatBytes(limit)}` : ''}</span>
      </div>
      {pct !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-[width] ${pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function Steps({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-1 text-sm">
        {steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2">
            {s.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="worked" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="failed" />}
            <span>{s.step}{s.ok ? <span className="text-muted-foreground"> ({s.ms} ms)</span> : <span className="block text-destructive">{s.error}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Where this school's files are kept, how much room is used, and where new files go. Clerk, principal and admin. */
export function StorageSettings() {
  const { t } = useT()
  const [s, setS] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)

  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  const [linking, setLinking] = useState(false)
  const load = useCallback(() => api<Status>('/storage').then(setS).catch((e) => { setError(e.message); toast.error(e.message) }), [])
  useEffect(() => { void load() }, [load])

  // Google sends the person back here with ?drive=connected (or denied / error).
  useEffect(() => {
    const r = params.get('drive')
    if (!r) return
    if (r === 'connected') toast.success(t('Google Drive is connected.'))
    else if (r === 'denied') toast.error(t('You did not allow access, so Google Drive was not connected.'))
    else toast.error(t('Google Drive could not be connected. Try again.'))
    setParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectDrive = async () => {
    setLinking(true)
    try { const { url } = await api<{ url: string }>('/storage/drive/connect', { method: 'POST', body: {} }); window.location.assign(url) }
    catch (e) { toast.error((e as Error).message); setLinking(false) }
  }
  const disconnectDrive = async () => {
    if (!confirm(t('Disconnect Google Drive? Files already in Drive stay there, and open again when you reconnect the same Google account.'))) return
    try { await api('/storage/drive/disconnect', { method: 'POST', body: {} }); toast.success(t('Disconnected')); await load() }
    catch (e) { toast.error((e as Error).message) }
  }

  const choose = async (mode: Mode) => {
    if (!s || mode === s.mode) return
    setBusy(true)
    try { setS(await api<Status>('/storage/mode', { method: 'PUT', body: { mode } })); toast.success(t('Saved')) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const check = async () => {
    setChecking(true)
    try { setResult(await api<CheckResult>('/storage/check', { method: 'POST', body: {} })) }
    catch (e) { toast.error((e as Error).message) } finally { setChecking(false) }
  }

  if (!s) return error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{t('Could not load storage: {error}', { error })}</p> : <p className="text-muted-foreground">{t('Loading…')}</p>

  const reasons: Record<Reason, string> = {
    'drive-not-set-up': t('Google Drive is not connected, so everything goes to the main storage.'),
    'chosen-main': t('You chose the main storage, so new files go there.'),
    'chosen-drive': t('You chose Google Drive, so new files go there.'),
    'auto-main': t('The main storage has room, so new files go there.'),
    'auto-main-full': t('The main storage is full, so new files are going to Google Drive.'),
  }
  const providerName: Record<Status['main']['provider'], string> = {
    'cloudflare-r2': 'Cloudflare R2', 'amazon-s3': 'Amazon S3', 's3-compatible': t('S3-compatible bucket'), disk: t("This server's disk"),
  }
  const mainName = providerName[s.main.provider]
  const driveLimit = s.drive.quotaLimitBytes
  const rows = [
    { key: 'main', name: mainName, sub: s.main.bucket ? `${s.main.bucket}${s.main.endpointHost ? ` · ${s.main.endpointHost}` : ''}` : t('Files kept on the server'), connected: true, used: s.main.usedBytes, limit: s.main.limitBytes ?? s.main.disk?.totalBytes ?? null, color: 'bg-primary', icon: HardDrive },
    { key: 'drive', name: 'Google Drive', sub: s.drive.account ?? t('Extra space when main storage is full'), connected: s.drive.configured, used: s.drive.usedBytes, limit: driveLimit, color: 'bg-sky-500', icon: Cloud },
  ]
  const totalUsed = rows.reduce((n, r) => n + r.used, 0)
  const modes: { id: Mode; title: string; text: string; needsDrive?: boolean }[] = [
    { id: 'auto', title: t('Automatic (recommended)'), text: t('Use the main storage, and switch to Google Drive by itself when the main storage is full.') },
    { id: 'primary', title: t('Main storage only'), text: t('Always use the main storage, even when it is nearly full.') },
    { id: 'drive', title: t('Google Drive only'), text: t('Send every new file to Google Drive.'), needsDrive: true },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><HardDrive className="size-6" aria-hidden />{t('Storage')}</h1>
        <p className="text-sm text-muted-foreground">{t('Where the school\'s files are kept. Files already stored stay where they are when you change this; only new files follow it.')}</p>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="overview-storage">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="overview-storage" className="font-medium">{t('All connected storage')}</h2>
          <p className="text-sm text-muted-foreground">{t('Stored by all schools on this server: {size}', { size: formatBytes(totalUsed) })}</p>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={t('Share of stored files by place')}>
          {totalUsed > 0 && rows.map((r) => r.used > 0 && <div key={r.key} className={r.color} style={{ width: `${(r.used / totalUsed) * 100}%` }} />)}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium"><span className={`size-2.5 rounded-full ${r.color}`} aria-hidden />{r.name}</span>
                <Badge variant={r.connected ? 'default' : 'outline'}>{r.connected ? t('Connected') : t('Not connected')}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{r.sub}</p>
              {r.connected ? <p className="mt-2 text-sm tabular-nums"><strong>{formatBytes(r.used)}</strong>{r.limit ? <span className="text-muted-foreground"> {t('of {size}', { size: formatBytes(r.limit) })}</span> : <span className="text-muted-foreground"> {t('(no size limit set)')}</span>}</p> : <p className="mt-2 text-xs text-muted-foreground">{t('Use Connect Google Drive below.')}</p>}
            </li>
          ))}
        </ul>
        {s.main.provider === 'disk' && <p className="text-xs text-muted-foreground">{t('Cloudflare R2 or Amazon S3 is not connected: files are kept on this server. Connect a bucket to keep them safe if the server is lost.')}</p>}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="where-new">
        <h2 id="where-new" className="font-medium">{t('Where new files go')}</h2>
        <p role="status" className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          {s.reason === 'auto-main-full' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />}
          <span><strong>{s.activeNow === 'drive' ? t('Right now: Google Drive.') : t('Right now: main storage.')}</strong> {reasons[s.reason]}</span>
        </p>
        <div role="radiogroup" aria-label={t('Where new files go')} className="grid gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const disabled = busy || (!!m.needsDrive && !s.drive.configured)
            return (
              <button
                key={m.id} type="button" role="radio" aria-checked={s.mode === m.id} disabled={disabled}
                onClick={() => choose(m.id)}
                className={`rounded-lg border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${s.mode === m.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent/50'}`}
              >
                <span className="block text-sm font-medium">{m.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{m.text}</span>
                {m.needsDrive && !s.drive.configured && <span className="mt-1 block text-xs text-muted-foreground">{t('Needs Google Drive to be connected first.')}</span>}
              </button>
            )
          })}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="main-storage">
          <div className="flex items-center justify-between gap-2">
            <h2 id="main-storage" className="flex items-center gap-2 font-medium"><HardDrive className="size-4" aria-hidden />{t('Main storage')}</h2>
            <Badge variant="secondary">{mainName}</Badge>
          </div>
          <Bar used={s.main.usedBytes} limit={s.main.limitBytes} label={t('Used by all schools on this server')} />
          {s.main.disk && <Bar used={s.main.disk.totalBytes - s.main.disk.freeBytes} limit={s.main.disk.totalBytes} label={t('Server disk: {free} free', { free: formatBytes(s.main.disk.freeBytes) })} />}
          {!s.main.limitBytes && <p className="text-xs text-muted-foreground">{t('No size limit is set, so Automatic only switches to Google Drive if the main storage refuses a file. The server\'s owner can set a limit.')}</p>}
          <p className="text-sm text-muted-foreground">{t('This school: {size} in {n} file(s)', { size: formatBytes(s.main.schoolBytes), n: s.main.schoolFiles })}</p>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="drive-storage">
          <div className="flex items-center justify-between gap-2">
            <h2 id="drive-storage" className="flex items-center gap-2 font-medium"><Cloud className="size-4" aria-hidden />{t('Google Drive')}</h2>
            <Badge variant={s.drive.configured ? 'default' : 'outline'}>{s.drive.configured ? t('Connected') : t('Not connected')}</Badge>
          </div>
          {s.drive.configured ? (
            <>
              {s.drive.account && <p className="text-sm text-muted-foreground">{t('Account: {email}', { email: s.drive.account })}</p>}
              {s.drive.quotaUsedBytes !== null && <Bar used={s.drive.quotaUsedBytes} limit={s.drive.quotaLimitBytes} label={t('Used in this Google account')} />}
              {s.drive.error && <p role="alert" className="text-sm text-destructive">{s.drive.error}</p>}
              <p className="text-sm text-muted-foreground">{t('This school: {size} in {n} file(s)', { size: formatBytes(s.drive.schoolBytes), n: s.drive.schoolFiles })}</p>
              {s.drive.shareWith && <p className="text-xs text-muted-foreground">{t('To let the school read a private Drive file, share it with {email}.', { email: s.drive.shareWith })}</p>}
              {s.drive.source === 'connected' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {s.drive.folderUrl && <Button asChild size="sm" variant="outline"><a href={s.drive.folderUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />{t('Open the folder in Google Drive')}</a></Button>}
                  <Button size="sm" variant="outline" onClick={connectDrive} disabled={linking}>{t('Use a different account')}</Button>
                  <Button size="sm" variant="outline" onClick={disconnectDrive}><Link2Off className="size-4" aria-hidden />{t('Disconnect')}</Button>
                </div>
              )}
              {s.drive.source === 'server' && <p className="text-xs text-muted-foreground">{t("Connected through the server's settings, not through sign-in.")}</p>}
              <p className="text-xs text-muted-foreground">{t('Principal, admin, clerk and teachers can upload and view files in Drive files. Students and parents cannot.')}</p>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("Connect the school's Google Drive. You will sign in on Google's own page and choose Allow. Staff can then keep photos, videos and documents there, and it takes extra files when the main storage is full.")}</p>
              {s.drive.canConnect
                ? <Button onClick={connectDrive} disabled={linking}>{linking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Cloud className="size-4" aria-hidden />}{t('Connect Google Drive')}</Button>
                : <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{t('Google sign-in is not set up on this server yet. The person who runs the server adds a Google client ID and secret first (see SERVICES.md, "Connect Google Drive").')}</p>}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="check-storage">
        <h2 id="check-storage" className="font-medium">{t('Test the connection')}</h2>
        <p className="text-sm text-muted-foreground">{t('Saves a small test file, reads it back and deletes it, in the main storage and in Google Drive.')}</p>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={checking} onClick={check}>
          {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}{checking ? t('Testing…') : t('Run the test')}
        </Button>
        {result && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Steps title={t('Main storage')} steps={result.main.steps} />
            {result.drive ? <Steps title={t('Google Drive')} steps={result.drive.steps} /> : <p className="text-sm text-muted-foreground">{t('Google Drive is not connected.')}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
