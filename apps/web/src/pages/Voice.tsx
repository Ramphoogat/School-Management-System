import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Ban, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Users, Video, VideoOff, Volume2 } from 'lucide-react'
import { api } from '@/lib/api'
import { CallClient, mediaSupported, screenShareSupported, type RemotePeer } from '@/lib/call'
import { playCue } from '@/lib/sounds'
import { useSpeaking } from '@/lib/speaking'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'

/** People the server never lets anyone moderate; their buttons are simply not shown. */
const MANAGER_ROLES = ['teacher', 'clerk', 'principal', 'admin']

interface Channel { id: string; name: string; participants: { name: string; role: string }[] }
interface ListData { canManage: boolean; max: number; channels: Channel[] }

/** One video or audio tile. The <video> element also plays the sound, so audio-only people still get one. */
function Tile({ stream, name, muted, showVideo, micOn, badge, big, actions }: { stream: MediaStream | null; name: string; muted?: boolean; showVideo: boolean; micOn?: boolean; badge?: string; big?: boolean; actions?: React.ReactNode }) {
  const { t } = useT()
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream }, [stream])
  const speaking = useSpeaking(stream, !big && micOn !== false) // a screen share is not a voice
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className={`relative overflow-hidden rounded-lg border bg-muted ${big ? 'aspect-video w-full' : 'aspect-video'} ${speaking ? 'ring-2 ring-green-500' : ''}`} data-speaking={speaking || undefined}>
      <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full ${big ? 'object-contain bg-black' : 'object-cover'} ${showVideo ? '' : 'invisible'}`} />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">{initials || '?'}</span>
        </div>
      )}
      <div className="absolute bottom-1 left-1 flex max-w-[90%] items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {micOn === false && <MicOff className="h-3 w-3 text-red-400" />}
        <span className="truncate">{name}</span>
        {badge && <span className="opacity-70">· {badge}</span>}
        {speaking && <span className="sr-only">{t('speaking')}</span>}
      </div>
      {actions && <div className="absolute right-1 top-1 flex gap-1">{actions}</div>}
    </div>
  )
}

/** Private notes, saved automatically as you type. Nobody else can read them. */
function Notes({ channelId }: { channelId: string }) {
  const { t: tr } = useT()
  const [text, setText] = useState('')
  const [state, setState] = useState<'loading' | 'saved' | 'saving' | 'unsaved'>('loading')
  const latest = useRef('')
  const dirty = useRef(false)

  const save = useCallback(async () => {
    if (!dirty.current) return
    dirty.current = false
    setState('saving')
    try { await api(`/voice/${channelId}/notes`, { method: 'PUT', body: { body: latest.current } }); setState(dirty.current ? 'unsaved' : 'saved') }
    catch { dirty.current = true; setState('unsaved') }
  }, [channelId])

  useEffect(() => {
    api<{ body: string }>(`/voice/${channelId}/notes`).then((n) => { latest.current = n.body; setText(n.body); setState('saved') }).catch(() => setState('unsaved'))
    return () => { void save() } // do not lose the last words when leaving the call
  }, [channelId, save])

  useEffect(() => {
    if (state !== 'unsaved') return
    const t = setTimeout(() => void save(), 800)
    return () => clearTimeout(t)
  }, [text, state, save])

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{tr('My notes')}</h3>
        <span className="text-xs text-muted-foreground">{state === 'loading' ? 'Loading…' : state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved · only you can see this' : 'Unsaved changes'}</span>
      </div>
      <Textarea className="min-h-48 flex-1 resize-none" placeholder={tr('Write down what you want to remember from this call…')} value={text} disabled={state === 'loading'} maxLength={20000}
        onChange={(e) => { latest.current = e.target.value; dirty.current = true; setText(e.target.value); setState('unsaved') }} />
    </div>
  )
}

function CallRoom({ channel, canModerate, onLeave }: { channel: { id: string; name: string }; canModerate: boolean; onLeave: () => void }) {
  const { t } = useT()
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const client = useRef<CallClient | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live'>('connecting')

  useEffect(() => {
    let cancelled = false // React may mount, unmount and remount in development; only the live instance may end the call
    const c = new CallClient(channel.id, redraw, (reason) => { if (cancelled) return; if (reason) { toast.error(reason); playCue('selfLeave') } onLeave() })
    client.current = c
    c.onScreenEnded = () => playCue('shareOff') // sharing stopped from the browser's own "Stop sharing" bar
    c.onMuted = (by) => { toast.info(`${by} muted your microphone. Press Unmute when you want to talk.`); playCue('mute'); redraw() }
    c.onPeerEvent = (e) => playCue(e === 'join' ? 'peerJoin' : 'peerLeave') // someone else came or went
    c.join()
      .then(async () => {
        if (cancelled) return
        setStatus('live')
        playCue('selfJoin')
        try { await c.startMic() } catch (e) { toast.info(`${(e as Error).message} You joined as a listener.`) }
        redraw()
      })
      .catch((e: Error) => { if (cancelled) return; toast.error(e.message); onLeave() })
    const bye = () => c.leave()
    window.addEventListener('beforeunload', bye)
    return () => { cancelled = true; window.removeEventListener('beforeunload', bye); c.leave() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id])

  const c = client.current
  const run = async (fn: () => Promise<void> | void) => { try { await fn() } catch (e) { toast.error((e as Error).message) } }

  const peers = c ? [...c.peers.values()] : []
  const camOf = (p: RemotePeer) => p.streams.find((s) => s.id !== p.state.screenStreamId) ?? null
  const screenOf = (p: RemotePeer) => (p.state.screenStreamId ? p.streams.find((s) => s.id === p.state.screenStreamId) ?? null : null)
  const screens = [
    ...(c?.screenStream ? [{ key: 'me-screen', stream: c.screenStream, name: 'Your screen', muted: true }] : []),
    ...peers.flatMap((p) => { const s = screenOf(p); return s ? [{ key: `${p.socketId}-screen`, stream: s, name: `${p.name}'s screen`, muted: false }] : [] }),
  ]
  const micOn = !!c?.micTrack && c.micEnabled
  const camOn = !!c?.camTrack
  const sharing = !!c?.screenStream

  const people = (
    <>
      <Tile stream={c?.camStream ?? null} name="You" muted showVideo={camOn} micOn={c?.micTrack ? micOn : undefined} />
      {peers.map((p) => (
        <Tile key={p.socketId} stream={camOf(p)} name={p.name} badge={p.role !== 'student' ? p.role : undefined} showVideo={p.state.camera} micOn={p.state.mic}
          actions={canModerate && !MANAGER_ROLES.includes(p.role) ? (
            <>
              {p.state.mic && <Button size="icon" variant="secondary" className="h-7 w-7" aria-label={`Mute ${p.name}`} title={t('Mute')} onClick={() => run(() => c!.moderate(p.socketId, 'mute'))}><MicOff className="h-3.5 w-3.5" /></Button>}
              <Button size="icon" variant="destructive" className="h-7 w-7" aria-label={`Remove ${p.name} from the call`} title={t('Remove from call')} onClick={() => { if (window.confirm(`Remove ${p.name} from the call? They cannot rejoin for a few minutes.`)) void run(() => c!.moderate(p.socketId, 'remove')) }}><Ban className="h-3.5 w-3.5" /></Button>
            </>
          ) : undefined} />
      ))}
    </>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Volume2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">{channel.name}</h2>
          <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> {peers.length + 1}</Badge>
          {status === 'connecting' && <span className="text-sm text-muted-foreground">{t('Connecting…')}</span>}
          {c && !c.micTrack && status === 'live' && <span className="text-sm text-muted-foreground">{t('Listening only. Turn on the mic to talk.')}</span>}
        </div>

        {screens.length > 0 ? (
          <div className="space-y-2">
            {screens.map((s) => <Tile key={s.key} big stream={s.stream} name={s.name} muted={s.muted} showVideo />)}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{people}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{people}</div>
        )}

        <div className="sticky bottom-2 flex flex-wrap items-center justify-center gap-2 rounded-lg border bg-background p-2 shadow">
          <Button variant={micOn ? 'outline' : 'destructive'} onClick={() => run(async () => {
            if (!c?.micTrack) await c?.startMic()
            else c.setMicEnabled(!c.micEnabled)
            playCue(c?.micEnabled ? 'unmute' : 'mute')
          })} disabled={!mediaSupported()}>
            {micOn ? <Mic className="mr-1 h-4 w-4" /> : <MicOff className="mr-1 h-4 w-4" />} {micOn ? 'Mute' : c?.micTrack ? 'Unmute' : 'Turn on mic'}
          </Button>
          <Button variant={camOn ? 'default' : 'outline'} onClick={() => run(async () => {
            if (camOn) c?.stopCamera()
            else await c?.startCamera()
            playCue(c?.camTrack ? 'cameraOn' : 'cameraOff')
          })} disabled={!mediaSupported()}>
            {camOn ? <Video className="mr-1 h-4 w-4" /> : <VideoOff className="mr-1 h-4 w-4" />} {camOn ? 'Stop camera' : 'Camera'}
          </Button>
          {screenShareSupported() && (
            <Button variant={sharing ? 'default' : 'outline'} onClick={() => run(async () => {
              if (sharing) { c?.stopScreen(); playCue('shareOff') }
              else { await c?.startScreen(); if (c?.screenStream) playCue('shareOn') } // no cue if the person cancelled the picker
            })}>
              {sharing ? <MonitorOff className="mr-1 h-4 w-4" /> : <MonitorUp className="mr-1 h-4 w-4" />} {sharing ? 'Stop sharing' : 'Share screen'}
            </Button>
          )}
          <Button variant="destructive" onClick={() => { c?.leave(); playCue('selfLeave'); onLeave() }}><PhoneOff className="mr-1 h-4 w-4" /> {t('Leave')}</Button>
        </div>
        {!mediaSupported() && <p className="text-xs text-muted-foreground">{t('Microphone and camera need a secure (https) connection. You can still listen.')}</p>}
      </div>
      <aside className="rounded-lg border p-3 lg:sticky lg:top-4 lg:h-[calc(100dvh-8rem)]"><Notes channelId={channel.id} /></aside>
    </div>
  )
}

export function Voice({ classId }: { classId: string }) {
  const { t: tr } = useT()
  const [data, setData] = useState<ListData | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<{ id: string; name: string } | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await api<ListData>(`/voice/class/${classId}`)); setError('') } catch (e) { setError((e as Error).message) }
  }, [classId])

  useEffect(() => {
    load()
    if (active) return
    const t = setInterval(load, 5000) // keep "who is in the call" fresh
    return () => clearInterval(t)
  }, [load, active])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try { await api(`/voice/class/${classId}`, { body: { name } }); setName(''); toast.success(tr('Voice channel created')); await load() }
    catch (err) { toast.error((err as Error).message) }
  }
  const remove = async (id: string) => {
    try { await api(`/voice/${id}`, { method: 'DELETE' }); setConfirmDelete(null); toast.success(tr('Channel deleted')); await load() }
    catch (err) { toast.error((err as Error).message) }
  }

  if (active) return <CallRoom channel={active} canModerate={data?.canManage ?? false} onLeave={() => { setActive(null); void load() }} />
  if (error) return <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{error}</p>
  if (!data) return <p className="text-muted-foreground">{tr('Loading…')}</p>

  return (
    <div className="space-y-4">
      {data.canManage && (
        <form onSubmit={create} className="flex max-w-md gap-2">
          <Input placeholder={tr('New voice channel, e.g. Study room 1')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit">{tr('Create')}</Button>
        </form>
      )}
      {data.channels.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {tr('No voice channels yet.')}{data.canManage ? ' Create one above so students can talk, share their screen and use their camera.' : ' Your teacher can create study rooms here.'}
        </p>
      ) : (
        <div className="grid max-w-3xl gap-3">
          {data.channels.map((ch) => {
            const full = ch.participants.length >= data.max
            return (
              <div key={ch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium"><Volume2 className="h-4 w-4" /> {ch.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ch.participants.length === 0 ? 'Empty. Be the first to join.' : `${ch.participants.length} in the call: ${ch.participants.map((p) => p.name).join(', ')}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={full} onClick={() => setActive({ id: ch.id, name: ch.name })}>{full ? 'Full' : 'Join'}</Button>
                  {data.canManage && (confirmDelete === ch.id
                    ? <Button size="sm" variant="destructive" onClick={() => remove(ch.id)}>{tr('Confirm delete')}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(ch.id)}>{tr('Delete')}</Button>)}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tr('Calls are for up to {max} people. Your microphone and camera stay off until you turn them on.', { max: data.max })}</p>
    </div>
  )
}
