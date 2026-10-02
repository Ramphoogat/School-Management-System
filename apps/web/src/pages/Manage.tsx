import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useT } from '@/lib/i18n'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pager, usePaged } from '@/components/Pager'
import { ClassMembersPanel } from '@/components/ClassMembersPanel'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { RotateCcw, Trash2 } from 'lucide-react'

interface DeletedClass { id: string; name: string; deletedAt: string; deletedByName: string | null; members: number }

interface DirUser { id: string; name: string; email: string; role: string }

const selectCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const ROLE_OPTIONS = ['student', 'parent', 'teacher', 'clerk', 'principal', 'admin']

const statusVariant = (s: string) => (s === 'rejected' || s === 'revoked' ? 'destructive' : s === 'approved' ? 'default' : 'secondary')

export function RequestRole() {
  const { t } = useT()
  const [users, setUsers] = useState<DirUser[]>([])
  const [mine, setMine] = useState<any[]>([])
  const [targetUserId, setTarget] = useState('')
  const [requestedRole, setRole] = useState('teacher')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<any[]>('/role-requests/mine').then(setMine), [])
  useEffect(() => {
    api<DirUser[]>('/users/directory').then(setUsers)
    load()
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/role-requests', { body: { targetUserId, requestedRole, note: note || undefined } })
      toast.success(t('Request submitted for approval'))
      setNote('')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('Request a role change')}</h1>
      <form onSubmit={submit} className="max-w-md space-y-3">
        <select className={selectCls} aria-label={t('Person')} value={targetUserId} onChange={(e) => setTarget(e.target.value)} required>
          <option value="">{t('Select user…')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
          ))}
        </select>
        <select className={selectCls} aria-label={t('Role')} value={requestedRole} onChange={(e) => setRole(e.target.value)}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
        </select>
        <Textarea placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" disabled={busy || !targetUserId}>{t('Submit request')}</Button>
      </form>
      <div>
        <h2 className="mb-2 font-medium">{t('My requests')}</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('You have not submitted any requests yet.')}</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>{t('User')}</TableHead><TableHead>{t('Role')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead>{t('Decision note')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {mine.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.targetName}</TableCell>
                  <TableCell className="capitalize">{r.requestedRole}</TableCell>
                  <TableCell><Badge variant={statusVariant(r.status)} className="capitalize">{r.status}</Badge></TableCell>
                  <TableCell>{r.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

export function ParentLinks() {
  const { t } = useT()
  const { can } = useAuth()
  const canApprove = can('admissions', 'approve')
  const canPropose = can('admissions', 'write')
  const [links, setLinks] = useState<any[]>([])
  const pg_links = usePaged(links)
  const [parents, setParents] = useState<DirUser[]>([])
  const [students, setStudents] = useState<DirUser[]>([])
  const [parentId, setParent] = useState('')
  const [studentId, setStudent] = useState('')
  const [relationship, setRel] = useState('')

  const load = useCallback(() => api<any[]>('/links').then(setLinks), [])
  useEffect(() => {
    load()
    if (canPropose) {
      api<DirUser[]>('/users/directory?role=parent').then(setParents)
      api<DirUser[]>('/users/directory?role=student').then(setStudents)
    }
  }, [load, canPropose])

  const act = async (id: string, what: 'approve' | 'revoke') => {
    try {
      await api(`/links/${id}/${what}`, { method: 'POST', body: {} })
      toast.success(what === 'approve' ? 'Link approved' : 'Link revoked')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const propose = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/links', { body: { parentId, studentId, relationship } })
      toast.success(t('Link proposed for approval'))
      setRel('')
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('Parent–student links')}</h1>
      {canPropose && (
        <form onSubmit={propose} className="grid max-w-2xl gap-3 sm:grid-cols-4">
          <select className={selectCls} aria-label={t('Parent')} value={parentId} onChange={(e) => setParent(e.target.value)} required>
            <option value="">{t('Parent…')}</option>
            {parents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className={selectCls} aria-label={t('Student')} value={studentId} onChange={(e) => setStudent(e.target.value)} required>
            <option value="">{t('Student…')}</option>
            {students.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <Input placeholder={t('Relationship')} value={relationship} onChange={(e) => setRel(e.target.value)} required />
          <Button type="submit">{t('Propose link')}</Button>
        </form>
      )}
      {links.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('No links yet. A parent only sees a child’s data after an approved link.')}</p>
      ) : (
        <>
<Table>
          <TableHeader><TableRow><TableHead>{t('Parent')}</TableHead><TableHead>{t('Student')}</TableHead><TableHead>{t('Relationship')}</TableHead><TableHead>{t('Status')}</TableHead>{canApprove && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {pg_links.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.parent.name}</TableCell>
                <TableCell>{l.student.name}</TableCell>
                <TableCell className="capitalize">{l.relationship}</TableCell>
                <TableCell><Badge variant={statusVariant(l.status)} className="capitalize">{l.status}</Badge></TableCell>
                {canApprove && (
                  <TableCell className="space-x-2 text-right">
                    {l.status !== 'approved' && <Button size="sm" onClick={() => act(l.id, 'approve')}>{t('Approve')}</Button>}
                    {l.status !== 'revoked' && <Button size="sm" variant="outline" onClick={() => act(l.id, 'revoke')}>{t('Revoke')}</Button>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
<Pager {...pg_links.props} />
</>
      )}
    </div>
  )
}

export function Classes() {
  const { t } = useT()
  const { user, can } = useAuth()
  const canWrite = can('classes', 'write')
  const [classes, setClasses] = useState<any[]>([])
  const pg_classes = usePaged(classes)
  const [name, setName] = useState('')
  const [managing, setManaging] = useState<{ id: string; name: string } | null>(null)
  // Only the principal and admin may delete a class, see the deleted ones and restore them (the server enforces it too).
  const canDelete = can('classes', 'delete')
  const [deleted, setDeleted] = useState<DeletedClass[]>([])
  const [confirming, setConfirming] = useState<{ id: string; name: string; members: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    await api<any[]>('/classes').then(setClasses)
    if (canDelete) await api<DeletedClass[]>('/classes/deleted').then(setDeleted).catch(() => setDeleted([]))
  }, [canDelete])
  useEffect(() => { load() }, [load])
  const changed = async () => { await load(); window.dispatchEvent(new Event('classes-changed')) } // the side menu refreshes too

  const restore = async (c: { id: string; name: string }) => {
    try {
      await api(`/classes/${c.id}/restore`, { method: 'POST', body: {} })
      toast.success(t('{name} was restored', { name: c.name }))
      await changed()
    } catch (err) { toast.error((err as Error).message) }
  }

  const remove = async () => {
    if (!confirming) return
    const c = confirming
    setBusy(true)
    try {
      await api(`/classes/${c.id}`, { method: 'DELETE' })
      setConfirming(null)
      // The confirmation message offers an undo for a few seconds, and the class can always be restored from the list below.
      toast.success(t('{name} was deleted', { name: c.name }), { description: t('It is in “Deleted classes” below, where you can restore it.'), duration: 10000, action: { label: t('Undo'), onClick: () => void restore(c) } })
      await changed()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/classes', { body: { name } })
      toast.success(t('Class created'))
      setName('')
      await load()
      window.dispatchEvent(new Event('classes-changed'))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!canWrite && user?.role !== 'teacher') return <Navigate to="/" replace />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{canWrite ? 'Classes' : 'My classes'}</h1>
        {!canWrite && <p className="text-sm text-muted-foreground">{t('The classes you teach. Open one to see its students and choose the class monitor.')}</p>}
      </div>
      {canWrite && (
        <form onSubmit={create} className="flex max-w-md gap-2">
          <Input placeholder={t('e.g. Grade 9-B')} value={name} onChange={(e) => setName(e.target.value)} required />
          <Button type="submit">{t('Create')}</Button>
        </form>
      )}
      <>
<Table>
        <TableHeader><TableRow><TableHead>{t('Class')}</TableHead><TableHead>{t('Class teacher')}</TableHead><TableHead>{t('Members')}</TableHead><TableHead>{t('Channels')}</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {pg_classes.items.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell>{c.classTeacherName ?? <span className="text-muted-foreground">{t('Not assigned')}</span>}</TableCell>
              <TableCell>{c._count.members}</TableCell>
              <TableCell>{c.channels.length}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setManaging({ id: c.id, name: c.name })}>{canWrite ? 'Manage' : 'Open'}</Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" aria-label={t('Delete {name}', { name: c.name })} onClick={() => setConfirming({ id: c.id, name: c.name, members: c._count.members })}>
                      <Trash2 className="size-4" aria-hidden />{t('Delete')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
<Pager {...pg_classes.props} />
</>
      {canDelete && (
        <section aria-labelledby="deleted-classes" className="space-y-3">
          <div>
            <h2 id="deleted-classes" className="text-lg font-semibold">{t('Deleted classes')}</h2>
            <p className="text-sm text-muted-foreground">{t('A deleted class is hidden from its students, teachers and parents, but nothing is erased. Restore it to bring it back exactly as it was.')}</p>
          </div>
          {deleted.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t('No deleted classes.')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {deleted.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('Deleted {date}', { date: new Date(c.deletedAt).toLocaleDateString() })}{c.deletedByName ? ` · ${t('by {name}', { name: c.deletedByName })}` : ''} · {t('{n} member(s)', { n: c.members })}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5" aria-label={t('Restore {name}', { name: c.name })} onClick={() => restore(c)}>
                    <RotateCcw className="size-4" aria-hidden />{t('Restore')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AlertDialog open={!!confirming} onOpenChange={(o) => { if (!o && !busy) setConfirming(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete {name}?', { name: confirming?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('The class will disappear for its {n} member(s): its students, teachers and parents will no longer see it, its homework, books, chat or marks. Nothing is erased. You can restore it at any time from “Deleted classes”.', { n: confirming?.members ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void remove() }}>
              {busy ? t('Deleting…') : t('Delete class')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClassMembersPanel canManage={canWrite} cls={managing} onClose={() => setManaging(null)} onChanged={() => { void changed() }} />
    </div>
  )
}
