import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { useLiveRefresh } from '@/lib/live'
import { Button } from '@/components/ui/button'

interface Note { id: string; subject: string; body: string; createdAt: string; readAt: string | null }
type Filter = 'all' | 'unread' | 'read'

/** Every in-app notification the person has received, read and unread. */
export default function NotificationsPage() {
  const { t } = useT()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const load = useCallback(() => api<Note[]>('/notifications?limit=500').then(setNotes).catch((e) => toast.error(e.message)), [])
  useEffect(() => { void load() }, [load])
  useLiveRefresh(['todo'], load)

  const markRead = async (id: string) => {
    setNotes((all) => all?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null)
    await api(`/notifications/${id}/read`, { method: 'POST', body: {} }).catch(() => undefined)
  }
  const markAll = async () => {
    const now = new Date().toISOString()
    setNotes((all) => all?.map((n) => (n.readAt ? n : { ...n, readAt: now })) ?? null)
    await api('/notifications/read-all', { method: 'POST', body: {} }).catch((e) => toast.error(e.message))
  }

  const unread = notes?.filter((n) => !n.readAt).length ?? 0
  const shown = (notes ?? []).filter((n) => filter === 'all' || (filter === 'unread' ? !n.readAt : !!n.readAt))
  const tabs: [Filter, string][] = [['all', t('All')], ['unread', `${t('Unread')} (${unread})`], ['read', t('Read')]]

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('Notifications')}</h1>
          <p className="text-sm text-muted-foreground">{t('Everything sent to you, read and unread.')}</p>
        </div>
        {unread > 0 && <Button variant="outline" size="sm" onClick={markAll}><CheckCheck className="mr-1.5 h-4 w-4" />{t('Mark all read')}</Button>}
      </div>
      <div className="flex gap-1" role="tablist">
        {tabs.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={filter === k} size="sm" variant={filter === k ? 'default' : 'ghost'} onClick={() => setFilter(k)}>{label}</Button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {notes === null && <p className="p-6 text-center text-sm text-muted-foreground">{t('Loading…')}</p>}
        {notes && shown.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{filter === 'unread' ? t('You are all caught up.') : t('Nothing here yet.')}</p>}
        {shown.map((n) => (
          <button key={n.id} type="button" onClick={() => !n.readAt && markRead(n.id)} className="flex w-full items-start gap-3 border-b p-4 text-left last:border-0 hover:bg-accent/50">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`break-words text-sm ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}>{n.subject}</span>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
              </span>
              <span className="mt-0.5 block break-words text-sm text-muted-foreground">{n.body}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
