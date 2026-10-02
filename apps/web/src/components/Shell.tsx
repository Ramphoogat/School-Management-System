import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { ChevronDown, ChevronRight, Home, LogOut, Palette, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { TopBar } from '@/components/TopBar'
import { AppearanceDialog } from '@/components/AppearanceDialog'
import { CreateChannelDialog } from '@/components/CreateChannelDialog'
import { channelIcon } from '@/lib/channelIcons'
import { toast } from 'sonner'
import { CommandBar } from '@/components/CommandBar'
import { navItems, NAV_GROUPS } from '@/lib/nav'
import { useMessages } from '@/lib/messages'
import { Button } from '@/components/ui/button'
import { usePresence } from '@/lib/presence'
import { StatusDot } from '@/components/MembersPanel'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

interface ClassInfo {
  id: string
  name: string
  channels: { id: string; type: string; name: string; icon?: string | null }[]
  _count: { members: number }
}

/** Discord-style rail button: round at rest, squircle on hover/active, with a left indicator pill. */
function RailButton({ to, end, title, children, dashed }: { to: string; end?: boolean; title: string; children: React.ReactNode; dashed?: boolean }) {
  return (
    <NavLink to={to} end={end} title={title} aria-label={title} className="group relative flex w-full justify-center">
      {({ isActive }) => (
        <>
          <span
            className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all ${
              isActive ? 'h-9' : 'h-2 opacity-0 group-hover:opacity-100'
            }`}
          />
          <span
            className={`flex h-12 w-12 items-center justify-center text-sm font-semibold transition-all duration-200 ${
              dashed
                ? 'rounded-3xl border-2 border-dashed border-muted-foreground/40 text-muted-foreground group-hover:rounded-2xl group-hover:border-primary group-hover:text-primary'
                : isActive
                  ? 'rounded-2xl bg-primary text-primary-foreground'
                  : 'rounded-3xl bg-secondary text-secondary-foreground group-hover:rounded-2xl group-hover:bg-primary group-hover:text-primary-foreground'
            }`}
          >
            {children}
          </span>
        </>
      )}
    </NavLink>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
    isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
  }`

const initials = (name?: string) =>
  (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export default function Shell() {
  const { user, logout, can } = useAuth()
  const { t } = useT()
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [cmd, setCmd] = useState(false)
  const [addingTo, setAddingTo] = useState<{ id: string; name: string } | null>(null)
  const { myStatus, setMyStatus } = usePresence()
  const [look, setLook] = useState(false)
  useEffect(() => {
    const h = () => setLook(true)
    window.addEventListener('open-appearance', h)
    return () => window.removeEventListener('open-appearance', h)
  }, [])
  // On tablets and phones the class rail (the strip with the Home button) can be shown or hidden with a small round button.
  // It starts open on a tablet and closed on a phone. On a wide screen it is always shown and the button is not.
  // Below the desktop width the narrow rail (Home and the classes) is always there, and the workspace list extends out beside it
  // when the round button is pressed. On wide screens both are always shown and this value is not used.
  const [railOpen, setRailOpen] = useState(false)
  const [planNote, setPlanNote] = useState<'expiring' | 'grace' | 'overdue' | null>(null)
  const seesBilling = can('billing', 'read')
  useEffect(() => {
    if (!seesBilling) return
    api<{ status: string }>('/school/billing').then((b) => setPlanNote(['expiring', 'grace', 'overdue'].includes(b.status) ? (b.status as 'expiring' | 'grace' | 'overdue') : null)).catch(() => undefined)
  }, [seesBilling, user?.id])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Ctrl/Cmd+K opens the command bar from anywhere.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((c) => !c) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const loc = useLocation()
  const nav = useNavigate()

  useEffect(() => {
    const load = () => api<ClassInfo[]>('/classes').then(setClasses).catch(() => setClasses([]))
    load()
    window.addEventListener('classes-changed', load)
    return () => window.removeEventListener('classes-changed', load)
  }, [user?.id])

  // On a phone the workspace list covers part of the page, so it closes after going to a page. On a tablet it stays open.
  // Escape closes it on either.
  useEffect(() => { if (window.innerWidth < 768) setRailOpen(false) }, [loc.pathname, loc.search])
  useEffect(() => {
    if (!railOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setRailOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [railOpen])

  // Every page has its own title (WCAG 2.4.2), which is also what a screen reader announces after a page change.
  useEffect(() => {
    const cls = classes.find((c) => loc.pathname.startsWith('/classes/' + c.id))
    const item = navItems(can, user?.role).filter((n) => n.to !== '/').sort((a, b) => b.to.length - a.to.length).find((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + '/'))
    const page = loc.pathname === '/' ? t('Home') : cls ? cls.name : item ? t(item.label) : ''
    const school = user?.school?.name ?? t('School Platform')
    document.title = page ? page + ' · ' + school : school
  }, [loc.pathname, classes, user, can, t])

  // Channel list is built from permissions, so users never see things they cannot use.
  const { unread } = useMessages()
  const workspace = navItems(can, user?.role)
  const sections = NAV_GROUPS.map((g) => ({ ...g, items: workspace.filter((w) => w.group === g.id) })).filter((g) => g.items.length > 0)
  // A section is open while you are on one of its pages; you can open or close the others yourself.
  const activeGroup = workspace.filter((w) => loc.pathname === w.to || loc.pathname.startsWith(w.to + '/')).sort((a, b) => b.to.length - a.to.length)[0]?.group
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  useEffect(() => { if (activeGroup) setOpenGroups((o) => (o.has(activeGroup) ? o : new Set(o).add(activeGroup))) }, [activeGroup])
  const toggleGroup = (id: string) => setOpenGroups((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Class managers and teachers can add channels; the API enforces the same rule.
  const channelActive = (classId: string, ch: { id: string; type: string }) => {
    if (loc.pathname !== `/classes/${classId}`) return false
    const p = new URLSearchParams(loc.search)
    return ch.type === 'text' ? p.get('cid') === ch.id : (p.get('channel') ?? 'announcements') === ch.type
  }
  const canAddChannels = can('classes', 'write') || user?.role === 'teacher'

  const rail = (
    <nav aria-label={t('Classes')} className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-muted/50 py-3">
      <RailButton to="/" end title={t('Home')}><Home className="h-5 w-5" /></RailButton>
      <div className="h-px w-8 bg-border" />
      {classes.map((c) => (
        <RailButton key={c.id} to={`/classes/${c.id}`} title={c.name}>
          {c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)}
        </RailButton>
      ))}
      {can('classes', 'write') && (
        <RailButton to="/classes" end title={t('Create a new class')} dashed><Plus className="h-5 w-5" /></RailButton>
      )}
    </nav>
  )

  const sidebar = (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-card">
      <nav aria-label={t('Workspace')} className="flex-1 overflow-y-auto px-2 py-3">
        <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Workspace')}</p>
        <NavLink to="/" end className={linkClass}>
          <Home className="h-4 w-4" /> {t('Home')}
        </NavLink>
        {sections.map((g) => {
          const open = openGroups.has(g.id)
          const hasUnread = g.id === 'messaging' && unread > 0
          return (
            <div key={g.id} className="mt-1">
              <button
                type="button" aria-expanded={open} aria-controls={`nav-${g.id}`} onClick={() => toggleGroup(g.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <g.icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{t(g.label)}</span>
                {hasUnread && !open && <span className="flex h-2 w-2 rounded-full bg-primary" aria-label={t('Unread messages')} />}
                <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
              </button>
              {open && (
                <div id={`nav-${g.id}`} className="ml-4 mt-0.5 space-y-0.5 border-l pl-2">
                  {g.items.map((w) => (
                    <NavLink key={w.to} to={w.to} className={linkClass}>
                      <w.icon className="h-4 w-4" />
                      <span className="truncate">{t(w.label)}</span>
                      {w.to === '/messages' && unread > 0 && <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{unread > 99 ? '99+' : unread}</span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {classes.map((c) => (
          <div key={c.id} className="mt-5">
            <div className="mb-1 flex items-center pr-1">
              <NavLink
                to={`/classes/${c.id}`}
                end
                className="min-w-0 flex-1 truncate px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {c.name}
              </NavLink>
              {canAddChannels && (
                <button
                  type="button"
                  onClick={() => setAddingTo({ id: c.id, name: c.name })}
                  title={t('Create a channel in {name}', { name: c.name })}
                  aria-label={t('Create a channel in {name}', { name: c.name })}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            {(loc.pathname === `/classes/${c.id}` || loc.pathname.startsWith(`/classes/${c.id}/`) ? c.channels : []).filter((ch) => (ch.type !== 'voice' || can('voice', 'join')) && (ch.type !== 'books' || user?.role !== 'parent')).map((ch) => (
              <div key={ch.id} className="group flex items-center">
                <Link
                  to={ch.type === 'text' ? `/classes/${c.id}?channel=text&cid=${ch.id}` : `/classes/${c.id}?channel=${ch.type}`}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${channelActive(c.id, ch) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
                >
                  {(() => { const Icon = channelIcon(ch.type, ch.icon); return <Icon className="h-4 w-4 shrink-0 opacity-70" /> })()}
                  <span className="truncate">{ch.name}</span>
                </Link>
                {ch.type === 'text' && canAddChannels && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(t('Delete #{name}? Its messages are deleted too.', { name: ch.name }))) return
                      try { await api(`/classes/${c.id}/channels/${ch.id}`, { method: 'DELETE' }); window.dispatchEvent(new Event('classes-changed')); if (new URLSearchParams(loc.search).get('cid') === ch.id) nav(`/classes/${c.id}`) }
                      catch (e) { toast.error((e as Error).message) }
                    }}
                    title={t('Delete #{name}', { name: ch.name })}
                    aria-label={t('Delete #{name}', { name: ch.name })}
                    className="ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive group-hover:flex"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <CreateChannelDialog cls={addingTo} onClose={() => setAddingTo(null)} />
      {/* User panel */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-muted/50 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="relative shrink-0 rounded-full" title={t('Set your status')} aria-label={t('Set your status')}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(user?.name)}</span>
              <StatusDot state={myStatus === 'online' ? 'online' : 'invisible'} className="absolute -bottom-0.5 -right-0.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel>{t('Your status')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setMyStatus('online')}><StatusDot state="online" /> {t('Online')}{myStatus === 'online' && ' ✓'}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMyStatus('invisible')} className="items-start">
              <StatusDot state="invisible" className="mt-1" />
              <span>{t('Invisible')}{myStatus === 'invisible' && ' ✓'}<span className="block text-xs text-muted-foreground">{t('You appear offline to others')}</span></span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs capitalize text-muted-foreground">{user?.role && t(user.role)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setLook(true)} title={t('Appearance')} aria-label={t('Appearance')}>
          <Palette className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={logout} title={t('Log out')} aria-label={t('Log out')}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  return (
    <div className="app-root isolate relative flex h-dvh flex-col bg-background">
      <a
        href="#main"
        onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t('Skip to main content')}
      </a>
      <div className="wallpaper-layer" aria-hidden />
      <TopBar onSearch={() => setCmd(true)} />
      <div className="relative flex min-h-0 flex-1">
      {/* The rail (Home and the classes) is always shown. The workspace list sits right beside it: always on wide screens; on a
          tablet it opens beside the rail and pushes the page over; on a phone it opens over the page, which dims (tap it to close).
          The round button on the edge opens and closes it. */}
      {railOpen && <div className="absolute inset-y-0 left-[72px] right-0 z-30 bg-black/50 md:hidden" onClick={() => setRailOpen(false)} aria-hidden />}
      <aside aria-label={t('Main menu')} className="relative z-40 flex shrink-0 border-r bg-background">
        {rail}
        <div
          id="workspace-menu"
          onClick={(e) => { if (window.innerWidth < 768 && (e.target as HTMLElement).closest('a')) setRailOpen(false) }} // on a phone, close as soon as a page is chosen
          className={`absolute inset-y-0 left-[72px] z-40 w-[min(240px,calc(100vw-112px))] border-l border-r bg-background shadow-2xl md:static md:w-[240px] md:border-r-0 md:shadow-none lg:flex ${railOpen ? 'flex' : 'hidden'}`}
        >
          {sidebar}
        </div>
      </aside>
      <button
        type="button"
        onClick={() => setRailOpen((o) => !o)}
        aria-expanded={railOpen}
        aria-controls="workspace-menu"
        aria-label={railOpen ? t('Hide the workspace menu') : t('Show the workspace menu')}
        title={railOpen ? t('Hide the workspace menu') : t('Show the workspace menu')}
        style={{ left: railOpen ? 'calc(72px + min(240px, calc(100vw - 112px)))' : 72 }}
        // A slim tab fixed to the edge of the menu, halfway down it, like a drawer handle. The empty space around it is part of the tap area.
        className="group absolute top-1/2 z-50 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-r-2xl border border-l-0 bg-card text-muted-foreground shadow-lg transition-[left,color,background-color,box-shadow] duration-200 before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:bg-accent hover:text-foreground hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-accent lg:hidden"
      >
        <ChevronRight className={`size-4 transition-transform duration-200 group-hover:scale-110 ${railOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-4 focus:outline-none max-lg:pl-8 sm:p-6 sm:max-lg:pl-8 lg:p-8">
        <div className="mx-auto w-full max-w-6xl">
          {!online && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{t('You are offline. Changes will not save until you are back online.')}</div>}
          {planNote && (
            <div role="status" className={`mb-4 rounded-md border p-3 text-sm ${planNote === 'overdue' ? 'border-destructive/50 bg-destructive/10' : 'border-amber-500/50 bg-amber-500/10'}`}>
              {planNote === 'expiring' ? t('Your school’s plan ends soon.') : planNote === 'grace' ? t('Your school’s plan has ended.') : t('Your school’s plan has ended, so new students cannot be added.')} <Link to="/school-plan" className="font-medium underline">{t('See the plan')}</Link>
            </div>
          )}
          {user?.mustChangePassword && (
            <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {t('You are using a temporary password.')} <Link to="/settings" className="font-medium underline">{t('Change it now')}</Link>.
            </div>
          )}
          <Suspense fallback={<p className="py-8 text-center text-muted-foreground">{t('Loading…')}</p>}><Outlet /></Suspense>
          <CommandBar open={cmd} onOpenChange={setCmd} />
          <AppearanceDialog open={look} onOpenChange={setLook} />
        </div>
      </main>
      </div>
    </div>
  )
}
