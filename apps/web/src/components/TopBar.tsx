import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bell, CheckCheck, LogOut, MessageSquare, Palette, Search, Settings } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { useLiveRefresh } from '@/lib/live'
import { useMessages } from '@/lib/messages'
import { usePresence } from '@/lib/presence'
import { logoSrc } from '@/lib/tenant'
import { StatusDot } from '@/components/MembersPanel'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Note { id: string; subject: string; body: string; createdAt: string; readAt: string | null }

const initials = (name?: string) => (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const badge = (n: number) => (n > 99 ? '99+' : String(n))

/** A small round count shown on a corner of an icon button. */
function Count({ n }: { n: number }) {
  if (n <= 0) return null
  return <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">{badge(n)}</span>
}

/** The bell: recent alerts with a count of the unread ones. Alerts are marked read when you click them. */
function Notifications() {
  const { t } = useT()
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const load = useCallback(() => api<Note[]>('/notifications').then(setNotes).catch(() => undefined), [])

  useEffect(() => { void load(); const poll = setInterval(load, 60_000); return () => clearInterval(poll) }, [load])
  useLiveRefresh(['todo'], load) // almost every change touches "todo", and alerts are created by those changes
  useEffect(() => { if (open) void load() }, [open, load])

  const unread = notes.filter((n) => !n.readAt).length
  const read = async (id: string) => {
    setNotes((all) => all.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    await api(`/notifications/${id}/read`, { method: 'POST', body: {} }).catch(() => undefined)
  }
  const readAll = async () => {
    const ids = notes.filter((n) => !n.readAt).map((n) => n.id)
    const now = new Date().toISOString()
    setNotes((all) => all.map((n) => (n.readAt ? n : { ...n, readAt: now })))
    await Promise.all(ids.map((id) => api(`/notifications/${id}/read`, { method: 'POST', body: {} }).catch(() => undefined)))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title={t('Notifications')} aria-label={unread ? `${t('Notifications')}: ${unread}` : t('Notifications')}>
          <Bell className="h-5 w-5" />
          <Count n={unread} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{t('Notifications')}</p>
          {unread > 0 && <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={readAll}><CheckCheck className="h-3.5 w-3.5" /> {t('Mark all read')}</Button>}
        </div>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
          {notes.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('You are all caught up.')}</p>}
          {notes.slice(0, 15).map((n) => (
            <button key={n.id} type="button" onClick={() => !n.readAt && read(n.id)} className="flex w-full items-start gap-2.5 border-b p-3 text-left last:border-0 hover:bg-accent/50">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`break-words text-sm ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}>{n.subject}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                </span>
                <span className="mt-0.5 block break-words text-xs text-muted-foreground">{n.body}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="border-t p-2 text-center">
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}><Link to="/notifications">{t('Open all notifications')}</Link></Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The bar across the top of every page: the school's logo and name, search, messages, alerts and your account.
 * The sidebar stays for moving between pages; this bar is for things that belong to you and to the whole school.
 */
export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { user, can, logout } = useAuth()
  const { t } = useT()
  const { unread } = useMessages()
  const { myStatus, setMyStatus } = usePresence()
  const logo = logoSrc(user?.school)
  const school = user?.school?.name ?? t('School Platform')

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:gap-3 sm:px-4">
      <Link to="/" className="flex shrink-0 items-center gap-2 rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`${school}: ${t('Home')}`}>
        {logo ? <img src={logo} alt="" className="h-8 w-8 rounded object-contain" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">{school.slice(0, 1).toUpperCase()}</span>}
      </Link>

      {/* The school's name sits in the middle of the bar, whatever is on either side. */}
      <p className="pointer-events-none absolute inset-x-0 mx-auto hidden w-1/3 truncate text-center font-semibold sm:block">{school}</p>
      <div className="flex-1" />

      <Button variant="outline" size="sm" className="hidden gap-2 text-muted-foreground md:inline-flex" onClick={onSearch}>
        <Search className="h-4 w-4" /> <span className="hidden lg:inline">{t('Search or jump to…')}</span><span className="lg:hidden">{t('Search')}</span> <kbd className="hidden rounded border px-1.5 text-xs lg:inline">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onSearch} title={t('Search or jump to…')} aria-label={t('Search or jump to…')}><Search className="h-5 w-5" /></Button>

      {can('messages', 'write') && (
        <Button asChild variant="ghost" size="icon" className="relative" title={t('Messages')} aria-label={unread ? `${t('Messages')}: ${unread}` : t('Messages')}>
          <Link to="/messages"><MessageSquare className="h-5 w-5" /><Count n={unread} /></Link>
        </Button>
      )}
      <Notifications />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="relative ml-0.5 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" title={user?.name} aria-label={t('Your account')}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(user?.name)}</span>
            <StatusDot state={myStatus === 'online' ? 'online' : 'invisible'} className="absolute -bottom-0.5 -right-0.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs capitalize text-muted-foreground">{user?.role && t(user.role)}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setMyStatus('online')}><StatusDot state="online" /> {t('Online')}{myStatus === 'online' && ' ✓'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMyStatus('invisible')} className="items-start">
            <StatusDot state="invisible" className="mt-1" />
            <span>{t('Invisible')}{myStatus === 'invisible' && ' ✓'}<span className="block text-xs text-muted-foreground">{t('You appear offline to others')}</span></span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link to="/settings"><Settings className="h-4 w-4" /> {t('Settings')}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event('open-appearance'))}><Palette className="h-4 w-4" /> {t('Appearance')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout}><LogOut className="h-4 w-4" /> {t('Log out')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
