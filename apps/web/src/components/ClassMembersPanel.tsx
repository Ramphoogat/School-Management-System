import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Crown, Search, Shield, UserMinus, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/lib/i18n'

interface Member { userId: string; name: string; email: string; role: string }
interface Candidate { id: string; name: string; email: string; role: string }
interface Data { classTeacherId: string | null; monitorId: string | null; members: Member[]; available: Candidate[] }

const selectCls = 'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm'

/** Side panel for one class: pick the class teacher, see who is in it, add or remove students and teachers. */
export function ClassMembersPanel({ cls, onClose, onChanged, canManage = true }: { cls: { id: string; name: string } | null; onClose: () => void; onChanged: () => void; canManage?: boolean }) {
  const { t: tr } = useT()
  const { user } = useAuth()
  const [d, setD] = useState<Data | null>(null)
  const [tab, setTab] = useState<'student' | 'teacher'>('student')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)

  const load = useCallback(async () => {
    if (!cls) return
    setD(await api<Data>(`/classes/${cls.id}/members`))
  }, [cls])

  useEffect(() => {
    setD(null); setQ(''); setPicked(new Set()); setTab('student')
    load().catch((e) => toast.error(e.message))
  }, [load])

  const teachersHere = d?.members.filter((m) => m.role === 'teacher') ?? []
  const studentsHere = d?.members.filter((m) => m.role === 'student') ?? []
  const candidates = useMemo(
    () => (d?.available ?? []).filter((c) => c.role === tab && `${c.name} ${c.email}`.toLowerCase().includes(q.trim().toLowerCase())),
    [d, tab, q],
  )
  const allPicked = candidates.length > 0 && candidates.every((c) => picked.has(c.id))

  const changed = async () => { await load(); onChanged() }

  const setTeacher = async (teacherId: string) => {
    if (!cls) return
    setBusy(true)
    try {
      await api(`/classes/${cls.id}/class-teacher`, { method: 'PUT', body: { teacherId: teacherId || null } })
      toast.success(teacherId ? 'Class teacher set' : 'Class teacher cleared')
      await changed()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  // Only a teacher of the class may choose the monitor; everyone else sees it read-only.
  const canPickMonitor = user?.role === 'teacher' && !!cls && teachersHere.some((t) => t.userId === user.id)
  const setMonitor = async (studentId: string) => {
    if (!cls) return
    setBusy(true)
    try {
      await api(`/classes/${cls.id}/monitor`, { method: 'PUT', body: { studentId: studentId || null } })
      toast.success(studentId ? 'Class monitor set' : 'Class monitor cleared')
      await changed()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const add = async () => {
    if (!cls || picked.size === 0) return
    setBusy(true)
    try {
      const r = await api<{ added: number }>(`/classes/${cls.id}/members`, { body: { userIds: [...picked] } })
      toast.success(`${r.added} added to ${cls.name}`)
      setPicked(new Set())
      await changed()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!cls || !removing) return
    setBusy(true)
    try {
      await api(`/classes/${cls.id}/members/${removing.userId}`, { method: 'DELETE' })
      toast.success(`${removing.name} removed`)
      setRemoving(null)
      await changed()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const person = (m: Member) => (
    <li key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          {m.name}
          {d?.classTeacherId === m.userId && <Badge className="gap-1"><Crown className="h-3 w-3" /> {tr('Class teacher')}</Badge>}
          {d?.monitorId === m.userId && <Badge variant="secondary" className="gap-1"><Shield className="h-3 w-3" /> {tr('Monitor')}</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
      </span>
      {canManage && (
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRemoving(m)} title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`}>
          <UserMinus className="h-4 w-4" />
        </Button>
      )}
    </li>
  )

  return (
    <>
      <Sheet open={!!cls} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="border-b p-4">
            <SheetTitle>{cls?.name}</SheetTitle>
            <SheetDescription>{d ? `${studentsHere.length} student(s), ${teachersHere.length} teacher(s)` : 'Loading…'}</SheetDescription>
          </SheetHeader>

          {d && (
            <div className="space-y-6 p-4">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{tr('Class teacher')}</h3>
                <select className={selectCls} disabled={busy || !canManage} value={d.classTeacherId ?? ''} onChange={(e) => setTeacher(e.target.value)} aria-label={tr('Class teacher')}>
                  <option value="">{tr('No class teacher')}</option>
                  {teachersHere.length > 0 && (
                    <optgroup label="In this class">
                      {teachersHere.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}
                    </optgroup>
                  )}
                  {d.available.some((c) => c.role === 'teacher') && (
                    <optgroup label="Other teachers (added to the class)">
                      {d.available.filter((c) => c.role === 'teacher').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                </select>
                <p className="text-xs text-muted-foreground">{canManage ? 'Choosing a teacher who is not in the class adds them to it.' : 'Set by the school office.'}</p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{tr('Class monitor')}</h3>
                <select className={selectCls} disabled={busy || !canPickMonitor} value={d.monitorId ?? ''} onChange={(e) => setMonitor(e.target.value)} aria-label={tr('Class monitor')}>
                  <option value="">{tr('No class monitor')}</option>
                  {studentsHere.map((st) => <option key={st.userId} value={st.userId}>{st.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">
                  {canPickMonitor
                    ? 'You choose the monitor from the students in your class.'
                    : studentsHere.length === 0
                      ? 'Add students to the class first. Only a teacher of the class can choose the monitor.'
                      : 'Only a teacher of this class can choose the monitor.'}
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">{tr('Teachers ({length})', { length: teachersHere.length })}</h3>
                <ul>{teachersHere.map(person)}</ul>
                {teachersHere.length === 0 && <p className="text-sm text-muted-foreground">{tr('No teachers yet.')}</p>}
              </section>

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">{tr('Students ({length})', { length: studentsHere.length })}</h3>
                <ul className="max-h-64 overflow-y-auto">{studentsHere.map(person)}</ul>
                {studentsHere.length === 0 && <p className="text-sm text-muted-foreground">{tr('No students yet.')}</p>}
              </section>

              {canManage && <section className="space-y-2 rounded-xl border p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><UserPlus className="h-4 w-4" /> {tr('Add to this class')}</h3>
                <div className="flex gap-1">
                  {(['student', 'teacher'] as const).map((r) => (
                    <Button key={r} size="sm" variant={tab === r ? 'default' : 'outline'} className="capitalize" onClick={() => { setTab(r); setPicked(new Set()) }}>{tr(r === 'teacher' ? 'Teachers' : 'Students')}</Button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder={`Search ${tab}s by name or email`} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {candidates.length > 0 && (
                  <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                    <Checkbox checked={allPicked} onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(candidates.map((c) => c.id)))} aria-label={tr('Select all shown')} />
                    Select all shown ({candidates.length})
                  </label>
                )}
                <ul className="max-h-56 overflow-y-auto">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
                        <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-sm">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {candidates.length === 0 && <p className="text-sm text-muted-foreground">{q ? 'No one matches.' : `Every ${tab} is already in this class.`}</p>}
                <Button className="w-full" disabled={busy || picked.size === 0} onClick={add}>
                  {picked.size ? `Add ${picked.size} ${tab}${picked.size === 1 ? '' : 's'}` : `Add ${tab}s`}
                </Button>
              </section>}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Remove {name} from {name2}?', { name: removing?.name, name2: cls?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('They lose access to this class\'s channels, homework and timetable.')}{removing && d?.classTeacherId === removing.userId ? ' They are the class teacher, so the class will have none until you choose another.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); remove() }}>{tr('Remove')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
