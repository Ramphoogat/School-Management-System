import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { BellRing, BookOpen, CheckCheck, ClipboardList, GraduationCap, LogOut, Megaphone, MessageSquare, Moon, Search, User, Volume2, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { navItems } from '@/lib/nav'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { useT } from '@/lib/i18n'

interface Cls { id: string; name: string }
interface Student { id: string; name: string; email: string; classes: Cls[] }
type Action = { key: string; label: string; hint?: string; icon: LucideIcon; run: () => void }

/** Ctrl/Cmd + K. Everything here navigates; nothing changes data without a confirmation on the page it opens. */
export function CommandBar({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: tr } = useT()
  const nav = useNavigate()
  const { user, can, logout } = useAuth()
  const [classes, setClasses] = useState<Cls[]>([])
  const [q, setQ] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const staff = can('admissions', 'write') || can('admissions', 'approve')

  useEffect(() => {
    if (open && classes.length === 0) api<Cls[]>('/classes').then(setClasses).catch(() => undefined)
    if (!open) { setQ(''); setStudents([]) }
  }, [open, classes.length])

  // Student search is only for roles that manage records, and the API enforces that too.
  useEffect(() => {
    if (!open || !staff || q.trim().length < 2) { setStudents([]); return }
    const t = setTimeout(() => api<Student[]>(`/students?q=${encodeURIComponent(q.trim())}`).then((r) => setStudents(r.slice(0, 6))).catch(() => setStudents([])), 200)
    return () => clearTimeout(t)
  }, [q, open, staff])

  const go = (to: string) => { onOpenChange(false); nav(to) }

  const pages = useMemo(() => navItems(can, user?.role), [can, user?.role])

  const actions = useMemo(() => {
    const a: Action[] = []
    for (const c of classes) {
      const at = (channel: string) => `/classes/${c.id}?channel=${channel}`
      if (can('attendance', 'bulk_write')) a.push({ key: `att-${c.id}`, label: `Mark attendance for ${c.name}`, icon: ClipboardList, run: () => go(at('attendance')) })
      if (can('announcements', 'write') || can('announcements', 'manage')) a.push({ key: `ann-${c.id}`, label: `Post an announcement in ${c.name}`, icon: Megaphone, run: () => go(at('announcements')) })
      if (can('homework', 'write')) a.push({ key: `hw-${c.id}`, label: `Assign homework in ${c.name}`, icon: BookOpen, run: () => go(at('homework')) })
      if (can('results', 'write')) a.push({ key: `gr-${c.id}`, label: `Enter marks for ${c.name}`, icon: GraduationCap, run: () => go(at('grades')) })
      if (can('chat', 'write')) a.push({ key: `ch-${c.id}`, label: `Open ${c.name} chat`, icon: MessageSquare, run: () => go(at('chat')) })
      if (can('voice', 'join')) a.push({ key: `vo-${c.id}`, label: `Join a ${c.name} voice channel`, icon: Volume2, run: () => go(at('voice')) })
    }
    if (can('leave', 'approve')) a.push({ key: 'q-leave', label: 'Review pending leave requests', hint: 'approve or reject in bulk', icon: CheckCheck, run: () => go('/leave') })
    if (can('role_requests', 'approve')) a.push({ key: 'q-roles', label: 'Review pending role requests', hint: 'approve or reject in bulk', icon: CheckCheck, run: () => go('/approvals') })
    if (can('results', 'approve')) a.push({ key: 'q-results', label: 'Review results awaiting approval', hint: 'approve or send back in bulk', icon: CheckCheck, run: () => go('/result-approvals') })
    if (can('fees', 'approve')) a.push({ key: 'q-waivers', label: 'Review fee waiver requests', hint: 'approve or decline in bulk', icon: CheckCheck, run: () => go('/waivers') })
    if (can('admissions', 'approve')) a.push({ key: 'q-adm', label: 'Review admission applications', hint: 'approve or reject in bulk', icon: CheckCheck, run: () => go('/admissions') })
    if (can('fees', 'bulk_write')) a.push({ key: 'fee-rec', label: 'Record fee payments', hint: 'mark invoices paid in bulk', icon: BellRing, run: () => go('/fees') })
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, can])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={tr('Command bar')} description="Search pages, classes and quick actions">
      <CommandInput placeholder={tr('Search pages, classes, people…')} value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{tr('Nothing matches. Try a class name or a page like “fees”.')}</CommandEmpty>
        {actions.length > 0 && (
          <CommandGroup heading="Quick actions">
            {actions.map((x) => (
              <CommandItem key={x.key} value={`${x.label} ${x.hint ?? ''}`} onSelect={x.run}>
                <x.icon /> <span>{x.label}</span>{x.hint && <span className="ml-auto text-xs text-muted-foreground">{x.hint}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {students.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Students">
              {students.map((s) => (
                <CommandItem key={s.id} value={`student ${s.name} ${s.email}`} onSelect={() => go(`/students?q=${encodeURIComponent(s.name)}`)}>
                  <User /> <span>{s.name}</span><span className="ml-auto text-xs text-muted-foreground">{s.classes.map((c) => c.name).join(', ')}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="home dashboard" onSelect={() => go('/')}><Search /> {tr('Home')}</CommandItem>
          {pages.map((p) => <CommandItem key={p.to} value={`go ${p.label}`} onSelect={() => go(p.to)}><p.icon /> {p.label}</CommandItem>)}
          {classes.map((c) => <CommandItem key={c.id} value={`class ${c.name}`} onSelect={() => go(`/classes/${c.id}`)}><GraduationCap /> {c.name}</CommandItem>)}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem value="toggle theme dark light" onSelect={() => { onOpenChange(false); window.dispatchEvent(new Event('open-appearance')) }}><Moon /> {tr('Appearance: theme, wallpaper, light / dark')}</CommandItem>
          <CommandItem value="sign out log out" onSelect={() => { onOpenChange(false); logout() }}><LogOut /> {tr('Sign out')}</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
