import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { socketAuth } from './api'
import { useAuth } from './auth'

export type MyStatus = 'online' | 'invisible'

interface Ctx {
  /** Whether someone is online right now (invisible users count as offline to everyone else). */
  isOnline: (userId: string) => boolean
  myStatus: MyStatus
  setMyStatus: (s: MyStatus) => void
  /** Listen for "something changed" signals from the server. Returns the unsubscribe function. */
  onLive: (fn: (kinds: string[]) => void) => () => void
}
const PresenceCtx = createContext<Ctx | null>(null)
const KEY = (id: string) => `presence:${id}`

/** One app-wide socket keeps the user "online" while the app is open and streams everyone else's presence. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [myStatus, setStatus] = useState<MyStatus>('online')
  const sock = useRef<Socket | null>(null)
  const status = useRef<MyStatus>('online')
  const liveListeners = useRef(new Set<(kinds: string[]) => void>())
  const onLive = useCallback((fn: (kinds: string[]) => void) => { liveListeners.current.add(fn); return () => { liveListeners.current.delete(fn) } }, [])

  useEffect(() => {
    if (!user) { setOnline(new Set()); return }
    let saved: MyStatus = 'online'
    try { if (localStorage.getItem(KEY(user.id)) === 'invisible') saved = 'invisible' } catch { /* ignore */ }
    status.current = saved
    setStatus(saved)
    // A function for auth, so a reconnect after the token was refreshed uses the newest one.
    const s = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', { auth: socketAuth(() => ({ status: status.current })) })
    sock.current = s
    let connectedBefore = false
    s.on('connect', () => {
      s.emit('set_status', { status: status.current }) // re-assert after reconnects
      // Changes may have happened while offline, so anything showing a queue refreshes.
      if (connectedBefore) liveListeners.current.forEach((fn) => fn(['*']))
      connectedBefore = true
    })
    s.on('queue:changed', (p: { kinds?: string[] }) => liveListeners.current.forEach((fn) => fn(p.kinds ?? ['*'])))
    s.on('presence_snapshot', (r: { online: string[] }) => setOnline(new Set(r.online)))
    s.on('presence', (r: { userId: string; online: boolean }) =>
      setOnline((prev) => { const n = new Set(prev); if (r.online) n.add(r.userId); else n.delete(r.userId); return n }))
    return () => { s.close(); sock.current = null }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMyStatus = useCallback((s: MyStatus) => {
    status.current = s
    setStatus(s)
    if (user) try { localStorage.setItem(KEY(user.id), s) } catch { /* ignore */ }
    sock.current?.emit('set_status', { status: s })
    // The server hides invisible users from others; mirror that for ourselves.
    if (user) setOnline((prev) => { const n = new Set(prev); if (s === 'invisible') n.delete(user.id); else n.add(user.id); return n })
  }, [user])

  const value = useMemo<Ctx>(() => ({ isOnline: (id) => online.has(id), myStatus, setMyStatus, onLive }), [online, myStatus, setMyStatus, onLive])
  return <PresenceCtx.Provider value={value}>{children}</PresenceCtx.Provider>
}

export function usePresence() {
  const c = useContext(PresenceCtx)
  if (!c) throw new Error('usePresence outside PresenceProvider')
  return c
}
