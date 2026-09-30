import { io, type Socket } from 'socket.io-client'
import { tokens } from './api'

/**
 * Peer-to-peer (mesh) voice, camera and screen sharing. The server only introduces people and relays
 * connection messages; media goes straight between browsers. Connection setup follows the standard
 * "perfect negotiation" pattern so adding a camera or a screen share later renegotiates cleanly.
 */

export interface PeerState { mic: boolean; camera: boolean; screenStreamId: string | null }
export interface RemotePeer { socketId: string; userId: string; name: string; role: string; state: PeerState; streams: MediaStream[] }

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/** STUN finds a route between browsers. Strict school networks may also need TURN (see SERVICES.md). */
export function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [{ urls: (import.meta.env.VITE_STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',') }]
  if (import.meta.env.VITE_TURN_URL) {
    list.push({ urls: import.meta.env.VITE_TURN_URL.split(','), username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL })
  }
  return list
}

interface Link {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  senders: Map<MediaStreamTrack, RTCRtpSender>
}

export class CallError extends Error {}

export const mediaSupported = () => !!navigator.mediaDevices?.getUserMedia
export const screenShareSupported = () => !!navigator.mediaDevices?.getDisplayMedia

export class CallClient {
  private socket: Socket
  private links = new Map<string, Link>()
  private myId = ''
  private ended = false
  peers = new Map<string, RemotePeer>()
  /** What I send: microphone and camera live in one stream, a screen share in another. */
  readonly camStream = new MediaStream()
  screenStream: MediaStream | null = null
  micTrack: MediaStreamTrack | null = null
  camTrack: MediaStreamTrack | null = null
  micEnabled = false
  connected = false
  /** Called when sharing ends from the browser's own stop button (not from our button). */
  onScreenEnded: (() => void) | null = null
  /** Someone else joined or left while I am in the call (not fired for the people already there when I join). */
  onPeerEvent: ((event: 'join' | 'leave', peer: RemotePeer) => void) | null = null
  /** A teacher or staff member switched my microphone off. */
  onMuted: ((by: string) => void) | null = null

  private channelId: string
  private onChange: () => void
  private onClosed: (reason: string) => void

  constructor(channelId: string, onChange: () => void, onClosed: (reason: string) => void) {
    this.channelId = channelId
    this.onChange = onChange
    this.onClosed = onClosed
    this.socket = io(API, { auth: { token: tokens.access }, reconnection: false })
    this.socket.on('disconnect', () => { this.connected = false; if (!this.ended) this.finish('You were disconnected from the call.') })
    this.socket.on('voice:muted', ({ by }: { by: string }) => { this.setMicEnabled(false); this.onMuted?.(by) })
    this.socket.on('voice:removed', ({ by }: { by: string }) => this.finish(`${by} removed you from the call.`))
    this.socket.on('voice:closed', () => this.finish('This voice channel was deleted.'))
    this.socket.on('voice:peer-joined', (p: RemotePeer) => { this.peers.set(p.socketId, { ...p, streams: [] }); this.link(p.socketId); this.onPeerEvent?.('join', p); this.onChange() })
    this.socket.on('voice:peer-left', ({ socketId }: { socketId: string }) => this.drop(socketId))
    this.socket.on('voice:peer-state', ({ socketId, state }: { socketId: string; state: PeerState }) => {
      const p = this.peers.get(socketId)
      if (p) { p.state = state; this.onChange() }
    })
    this.socket.on('voice:signal', ({ from, data }: { from: string; data: any }) => void this.onSignal(from, data))
  }

  /** Connects to the call. Resolves with the channel name, or throws a readable error. */
  async join(): Promise<string> {
    await new Promise<void>((res, rej) => {
      if (this.socket.connected) return res()
      this.socket.once('connect', () => res())
      this.socket.once('connect_error', () => rej(new CallError('Could not reach the server.')))
      setTimeout(() => rej(new CallError('Could not reach the server.')), 8000)
    })
    const r: any = await new Promise((res) => this.socket.emit('voice:join', { channelId: this.channelId }, res))
    if (!r?.ok) { this.finish(''); throw new CallError(r?.error ?? 'Could not join the call.') }
    this.myId = r.me.socketId
    this.connected = true
    for (const p of r.peers as Omit<RemotePeer, 'streams'>[]) this.peers.set(p.socketId, { ...p, streams: [] })
    for (const p of r.peers) this.link(p.socketId) // the newcomer starts the connections
    this.onChange()
    return r.channel.name
  }

  // ---- connections ----

  private send(to: string, data: unknown) { this.socket.emit('voice:signal', { channelId: this.channelId, to, data }) }

  private link(remoteId: string): Link {
    const existing = this.links.get(remoteId)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    const link: Link = { pc, polite: this.myId < remoteId, makingOffer: false, ignoreOffer: false, senders: new Map() }
    this.links.set(remoteId, link)

    pc.onicecandidate = (e) => { if (e.candidate) this.send(remoteId, { candidate: e.candidate }) }
    pc.onnegotiationneeded = async () => {
      try { link.makingOffer = true; await pc.setLocalDescription(); this.send(remoteId, { description: pc.localDescription }) }
      catch { /* a newer negotiation replaces this one */ } finally { link.makingOffer = false }
    }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); this.onChange() }
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track])
      const peer = this.peers.get(remoteId)
      if (!peer) return
      if (!peer.streams.includes(stream)) peer.streams = [...peer.streams, stream]
      stream.onremovetrack = () => { peer.streams = peer.streams.filter((s) => s.getTracks().length > 0); this.onChange() }
      e.track.onmute = e.track.onunmute = () => this.onChange()
      this.onChange()
    }

    // Always be able to receive audio and video, even when I am not sending (no microphone, listen-only).
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.addTransceiver('video', { direction: 'recvonly' })
    for (const t of this.camStream.getTracks()) link.senders.set(t, pc.addTrack(t, this.camStream))
    if (this.screenStream) for (const t of this.screenStream.getTracks()) link.senders.set(t, pc.addTrack(t, this.screenStream))
    return link
  }

  private async onSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (this.ended || !this.peers.has(from)) return
    const link = this.link(from)
    const { pc } = link
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable')
        link.ignoreOffer = !link.polite && collision
        if (link.ignoreOffer) return
        await pc.setRemoteDescription(data.description)
        if (data.description.type === 'offer') {
          await pc.setLocalDescription()
          this.send(from, { description: pc.localDescription })
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate) } catch (e) { if (!link.ignoreOffer) throw e }
      }
    } catch { /* one bad message must not end the call */ }
  }

  private drop(socketId: string) {
    const peer = this.peers.get(socketId)
    this.links.get(socketId)?.pc.close()
    this.links.delete(socketId)
    this.peers.delete(socketId)
    if (peer) this.onPeerEvent?.('leave', peer)
    this.onChange()
  }

  // ---- what I send ----

  private addToAll(track: MediaStreamTrack, stream: MediaStream) {
    for (const link of this.links.values()) link.senders.set(track, link.pc.addTrack(track, stream))
  }
  private removeFromAll(track: MediaStreamTrack) {
    for (const link of this.links.values()) {
      const s = link.senders.get(track)
      if (s) { try { link.pc.removeTrack(s) } catch { /* connection already closed */ } link.senders.delete(track) }
    }
  }
  private broadcastState() {
    this.socket.emit('voice:state', {
      channelId: this.channelId,
      mic: !!this.micTrack && this.micEnabled,
      camera: !!this.camTrack,
      screenStreamId: this.screenStream?.id ?? null,
    })
    this.onChange()
  }

  async startMic() {
    if (!mediaSupported()) throw new CallError('Your browser needs a secure (https) connection to use the microphone.')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      this.micTrack = s.getAudioTracks()[0]
      this.micEnabled = true
      this.camStream.addTrack(this.micTrack)
      this.addToAll(this.micTrack, this.camStream)
      this.broadcastState()
    } catch (e) { throw new CallError(mediaMessage(e, 'microphone')) }
  }

  setMicEnabled(on: boolean) {
    if (!this.micTrack) return
    this.micTrack.enabled = on
    this.micEnabled = on
    this.broadcastState()
  }

  async startCamera() {
    if (!mediaSupported()) throw new CallError('Your browser needs a secure (https) connection to use the camera.')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } })
      this.camTrack = s.getVideoTracks()[0]
      this.camTrack.onended = () => void this.stopCamera()
      this.camStream.addTrack(this.camTrack)
      this.addToAll(this.camTrack, this.camStream)
      this.broadcastState()
    } catch (e) { throw new CallError(mediaMessage(e, 'camera')) }
  }

  stopCamera() {
    const t = this.camTrack
    if (!t) return
    this.camTrack = null
    t.stop()
    this.camStream.removeTrack(t)
    this.removeFromAll(t)
    this.broadcastState()
  }

  async startScreen() {
    if (!screenShareSupported()) throw new CallError('Screen sharing is not available in this browser or on this device.')
    if (this.screenStream) return
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      this.screenStream = s
      for (const t of s.getTracks()) this.addToAll(t, s)
      s.getVideoTracks()[0].onended = () => { if (this.screenStream) { this.stopScreen(); this.onScreenEnded?.() } } // the browser's own "Stop sharing" button
      this.broadcastState()
    } catch (e) {
      if ((e as DOMException).name === 'NotAllowedError') return // the person cancelled the picker
      throw new CallError('Could not start screen sharing.')
    }
  }

  stopScreen() {
    const s = this.screenStream
    if (!s) return
    this.screenStream = null
    for (const t of s.getTracks()) { t.stop(); this.removeFromAll(t) }
    this.broadcastState()
  }

  // ---- moderation (only works for people who manage the class; the server checks) ----

  async moderate(socketId: string, action: 'mute' | 'remove'): Promise<void> {
    const r: { ok: boolean; error?: string } = await new Promise((res) => this.socket.emit('voice:moderate', { channelId: this.channelId, to: socketId, action }, res))
    if (!r?.ok) throw new CallError(r?.error ?? 'Could not do that.')
  }

  // ---- ending ----

  private finish(reason: string) {
    if (this.ended) return
    this.ended = true
    this.stopScreen()
    for (const t of this.camStream.getTracks()) t.stop()
    for (const l of this.links.values()) l.pc.close()
    this.links.clear(); this.peers.clear()
    this.socket.close()
    this.onClosed(reason)
  }

  leave() {
    if (this.ended) return
    this.socket.emit('voice:leave', { channelId: this.channelId })
    this.finish('')
  }
}

function mediaMessage(e: unknown, what: string) {
  const name = (e as DOMException).name
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Allow ${what} access in your browser to use it.`
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found on this device.`
  if (name === 'NotReadableError') return `Your ${what} is being used by another app.`
  return `Could not start the ${what}.`
}
