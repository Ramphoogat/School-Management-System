import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { io, type Socket } from 'socket.io-client'
import { toast } from 'sonner'
import { api, socketAuth } from './api'
import { useAuth } from './auth'

export interface LiveMessage {
  conversationId: string
  message: { id: string; body: string; senderId: string; createdAt: string; deleted?: boolean; edited?: boolean; about?: { id: string; name: string } | null; attachments?: { id: string; name: string; size: number; mime: string }[] }
  from: { id: string; name: string; role: string }
}

interface Ctx {
  unread: number
  refresh: () => Promise<void>
  /** Listen for new messages while a page is open. Returns the unsubscribe function. */
  onMessage: (fn: (m: LiveMessage) => void) => () => void
  /** Listen for other live events: dm:updated, dm:deleted, dm:read, dm:typing. */
  on: (event: string, fn: (payload: any) => void) => () => void
  /** Tell the other person you are typing (the server passes it on and rate-limits it). */
  typing: (conversationId: string) => void
}

const MessagesCtx = createContext<Ctx>({ unread: 0, refresh: async () => undefined, onMessage: () => () => undefined, on: () => () => undefined, typing: () => undefined })
export const useMessages = () => useContext(MessagesCtx)

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/**
 * Keeps one live connection for direct messages: it drives the unread badge, pops a small notice when a
 * message arrives while you are on another page, and feeds the Messages page in real time. If the live
 * connection is unavailable the count still refreshes every minute.
 */
export function MessagesProvider({ children }: { children: ReactNode }) {
  const { user, can } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const allowed = !!user && can('messages', 'write')
  const [unread, setUnread] = useState(0)
  const listeners = useRef(new Set<(m: LiveMessage) => void>())
  const others = useRef(new Map<string, Set<(p: any) => void>>())
  const sock = useRef<Socket | null>(null)
  const path = useRef(loc.pathname)
  path.current = loc.pathname

  const refresh = useCallback(async () => {
    if (!allowed) return
    try { setUnread((await api<{ count: number }>('/messages/unread')).count) } catch { /* the badge is a nicety */ }
  }, [allowed])

  useEffect(() => {
    if (!allowed) { setUnread(0); return }
    void refresh()
    const poll = setInterval(refresh, 60_000)
    // A function for auth so a reconnect always uses the newest token.
    const socket = io(API, { auth: socketAuth(), reconnectionDelayMax: 10_000 })
    sock.current = socket
    for (const ev of ['dm:updated', 'dm:deleted', 'dm:read', 'dm:typing']) socket.on(ev, (p) => others.current.get(ev)?.forEach((fn) => fn(p)))
    socket.on('dm:message', (m: LiveMessage) => {
      listeners.current.forEach((fn) => fn(m))
      if (m.message.senderId !== user!.id) {
        void refresh()
        if (!path.current.startsWith('/messages')) {
          toast(m.from.name, { description: m.message.body ? m.message.body.slice(0, 90) : 'Sent an attachment', action: { label: 'Open', onClick: () => nav(`/messages?c=${m.conversationId}`) } })
        }
      }
    })
    return () => { clearInterval(poll); socket.close(); sock.current = null }
  }, [allowed, user, refresh, nav])

  const value = useMemo<Ctx>(() => ({
    unread,
    refresh,
    onMessage: (fn) => { listeners.current.add(fn); return () => { listeners.current.delete(fn) } },
    on: (event, fn) => { const set = others.current.get(event) ?? new Set(); set.add(fn); others.current.set(event, set); return () => { set.delete(fn) } },
    typing: (conversationId) => { sock.current?.emit('dm:typing', { conversationId }) },
  }), [unread, refresh])

  return <MessagesCtx.Provider value={value}>{children}</MessagesCtx.Provider>
}
