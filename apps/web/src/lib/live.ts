import { useEffect, useRef } from 'react'
import { usePresence } from './presence'

/**
 * Refresh a page when the server says its data changed, so queues update without a reload. The server only sends a
 * category ("leave", "waivers" …); the page refetches through the normal API, so what it shows is still permission-checked.
 * A reconnect also refreshes, because changes may have been missed while offline.
 */
export function useLiveRefresh(kinds: string[], reload: () => unknown) {
  const { onLive } = usePresence()
  const latest = useRef(reload)
  latest.current = reload
  const wanted = kinds.join(',')

  useEffect(() => {
    const mine = new Set(wanted.split(','))
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onLive((changed) => {
      if (!changed.includes('*') && !changed.some((k) => mine.has(k))) return
      clearTimeout(timer)
      timer = setTimeout(() => { void Promise.resolve(latest.current()).catch(() => undefined) }, 150)
    })
    return () => { off(); clearTimeout(timer) }
  }, [onLive, wanted])
}
