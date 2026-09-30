import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Copy, KeyRound, MoreHorizontal, Pencil, Search, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import { SCHOOL_ROLES as ROLES, type Role } from '@school/permissions'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pager, usePaged } from '@/components/Pager'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/lib/i18n'

interface Row { id: string; name: string; email: string; role: Role; active: boolean; phone: string | null; mustChangePassword: boolean; createdAt: string }
type Creds = { name: string; email: string; tempPassword: string; reason: 'created' | 'reset' }
type Confirm = { kind: 'deactivate' | 'reactivate' | 'reset'; user: Row }

const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm'
const TOP: Role[] = ['admin', 'principal']

/** Add or edit one person. Role is only chosen when creating; changing it later has its own step. */
function FormDialog({ mode, user, roles, onClose, onDone }: { mode: 'create' | 'edit' | null; user: Row | null; roles: Role[]; onClose: () => void; onDone: (creds?: Creds) => void }) {
  const { t } = useT()
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'student' as Role })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mode === 'edit' && user) setF({ name: user.name, email: user.email, phone: user.phone ?? '', role: user.role })
    else if (mode === 'create') setF({ name: '', email: '', phone: '', role: roles.includes('student') ? 'student' : roles[0] })
  }, [mode, user, roles])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'create') {
        const r = await api<{ user: { name: string; email: string }; tempPassword: string }>('/users', { body: { name: f.name, email: f.email, role: f.role, phone: f.phone || undefined } })
        toast.success(`${r.user.name} added`)
        onDone({ name: r.user.name, email: r.user.email, tempPassword: r.tempPassword, reason: 'created' })
      } else if (user) {
        await api(`/users/${user.id}`, { method: 'PATCH', body: { name: f.name, email: f.email, phone: f.phone } })
        toast.success(t('Details saved'))
        onDone()
      }
      onClose()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add a user' : `Edit ${user?.name ?? ''}`}</DialogTitle>
          <DialogDescription>{mode === 'create' ? 'They get a one-time password and must choose their own at first sign-in.' : 'Changing the email changes what they sign in with.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">{t('Full name')}<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} autoFocus /></label>
          <label className="block space-y-1 text-sm font-medium">{t('Email')}<Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label className="block space-y-1 text-sm font-medium">{t('Phone')} <span className="font-normal text-muted-foreground">{t('(optional, with country code)')}</span><Input value={f.phone} placeholder="+91 98765 43210" onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} /></label>
          {mode === 'create' && (
            <label className="block space-y-1 text-sm font-medium">{t('Role')}<select className={`${selectCls} w-full capitalize`} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : mode === 'create' ? 'Add user' : 'Save'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({ user, roles, onClose, onDone }: { user: Row | null; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const { t } = useT()
  const [role, setRole] = useState<Role>('student')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (user) setRole(user.role) }, [user])
  const leaving = user && role !== user.role
    ? [
        user.role === 'student' && 'their parent links and any class monitor role',
        user.role === 'parent' && 'their links to children',
        user.role === 'teacher' && 'any class teacher role',
        !['student', 'teacher'].includes(role) && (user.role === 'student' || user.role === 'teacher') && 'their class memberships',
      ].filter(Boolean)
    : []
  const save = async () => {
    if (!user) return
    setBusy(true)
    try { await api(`/users/${user.id}/role`, { method: 'PUT', body: { role } }); toast.success(`${user.name} is now ${role}`); onDone(); onClose() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Change role for {name}', { name: user?.name })}</DialogTitle>
          <DialogDescription>{t('Currently')} <span className="capitalize">{user?.role}</span>{t('. Their menu and access change straight away.')}</DialogDescription>
        </DialogHeader>
        <select className={`${selectCls} w-full capitalize`} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t('New role')}>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {leaving.length > 0 && <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t('This removes {value}.', { value: leaving.join(', ') })}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={busy || !user || role === user.role} onClick={save}>{busy ? 'Saving…' : 'Change role'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The one-time password. It is not stored anywhere readable, so this is the only chance to copy it. */
function CredentialsDialog({ creds, onClose }: { creds: Creds | null; onClose: () => void }) {
  const { t } = useT()
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(t('Copied')) } catch { toast.error(t('Could not copy. Select it and copy by hand.')) }
  }
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{creds?.reason === 'reset' ? 'Password reset' : 'User added'}</DialogTitle>
          <DialogDescription>{t('Give these sign-in details to {name}. This password is shown only once.', { name: creds?.name })}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 rounded-lg border bg-muted p-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">{t('Email')}</dt><dd className="font-medium">{creds?.email}</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('Temporary password')}</dt>
            <dd className="flex items-center justify-between gap-2"><code className="select-all break-all font-mono text-base">{creds?.tempPassword}</code>
              <Button size="sm" variant="outline" onClick={() => creds && copy(creds.tempPassword)}><Copy className="mr-1.5 h-4 w-4" /> {t('Copy')}</Button></dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('They will be asked to choose a new password the first time they sign in.')}</p>
        <div className="flex justify-end"><Button onClick={onClose}>{t('Done')}</Button></div>
      </DialogContent>
    </Dialog>
  )
}

export function Users() {
  const { t: tr } = useT()
  const { user: me } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('')
  const [statusF, setStatusF] = useState<'' | 'active' | 'inactive'>('')
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; user: Row | null } | null>(null)
  const [roleFor, setRoleFor] = useState<Row | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [creds, setCreds] = useState<Creds | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<Row[]>('/users').then((r) => { setRows(r); setLoaded(true) }).catch((e) => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const isAdmin = me?.role === 'admin'
  // A principal manages everyone except admins and principals; only an admin hands those roles out.
  const assignable = useMemo<Role[]>(() => (isAdmin ? [...ROLES] : ROLES.filter((r) => !TOP.includes(r))), [isAdmin])
  const canManage = (u: Row) => isAdmin || !TOP.includes(u.role)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter((u) => (!t || `${u.name} ${u.email} ${u.phone ?? ''}`.toLowerCase().includes(t)) && (!roleF || u.role === roleF) && (!statusF || (statusF === 'active') === u.active))
  }, [rows, q, roleF, statusF])
  const pg = usePaged(shown)

  const run = async () => {
    if (!confirm) return
    const { kind, user: u } = confirm
    setBusy(true)
    try {
      if (kind === 'reset') {
        const r = await api<{ name: string; email: string; tempPassword: string }>(`/users/${u.id}/reset-password`, { body: {} })
        setCreds({ name: r.name, email: r.email, tempPassword: r.tempPassword, reason: 'reset' })
      } else {
        await api(`/users/${u.id}/${kind}`, { body: {} })
        toast.success(kind === 'deactivate' ? `${u.name} deactivated` : `${u.name} reactivated`)
      }
      setConfirm(null)
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const text: Record<Confirm['kind'], { title: string; body: string; action: string }> = {
    deactivate: { title: 'Deactivate this user?', body: 'They are signed out straight away and cannot sign in again until reactivated. Their history is kept.', action: 'Deactivate' },
    reactivate: { title: 'Reactivate this user?', body: 'They can sign in again with their current password.', action: 'Reactivate' },
    reset: { title: 'Reset this password?', body: 'A new one-time password is made and shown to you once. Their old password stops working.', action: 'Reset password' },
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{tr('Users')}</h1>
          <p className="text-sm text-muted-foreground">{loaded ? `${shown.length} of ${rows.length} people` : 'Loading…'}</p>
        </div>
        <Button onClick={() => setForm({ mode: 'create', user: null })}><UserPlus className="mr-1.5 h-4 w-4" /> {tr('Add user')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={tr('Search name, email or phone')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${selectCls} capitalize`} value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label={tr('Filter by role')}>
          <option value="">{tr('All roles')}</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className={selectCls} value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} aria-label={tr('Filter by status')}>
          <option value="">{tr('Active and deactivated')}</option>
          <option value="active">{tr('Active')}</option>
          <option value="inactive">{tr('Deactivated')}</option>
        </select>
      </div>

      {loaded && shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{tr('No one matches.')}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr('Name')}</TableHead><TableHead>{tr('Role')}</TableHead><TableHead>{tr('Phone')}</TableHead><TableHead>{tr('Status')}</TableHead><TableHead className="w-12" /></TableRow>
            </TableHeader>
            <TableBody>
              {pg.items.map((u) => (
                <TableRow key={u.id} className={u.active ? '' : 'opacity-60'}>
                  <TableCell>
                    <div className="font-medium">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{tr('(you)')}</span>}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{u.role}</Badge></TableCell>
                  <TableCell className="tabular-nums">{u.phone ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {u.active ? <Badge>{tr('Active')}</Badge> : <Badge variant="destructive">{tr('Deactivated')}</Badge>}
                    {u.active && u.mustChangePassword && <div className="mt-0.5 text-xs text-muted-foreground">{tr('Hasn\'t set a password yet')}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage(u) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${u.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => setForm({ mode: 'edit', user: u })}><Pencil className="h-4 w-4" /> {tr('Edit details')}</DropdownMenuItem>
                          {u.id !== me?.id && <DropdownMenuItem onSelect={() => setRoleFor(u)}><ShieldCheck className="h-4 w-4" /> {tr('Change role')}</DropdownMenuItem>}
                          {u.id !== me?.id && <DropdownMenuItem onSelect={() => setConfirm({ kind: 'reset', user: u })}><KeyRound className="h-4 w-4" /> {tr('Reset password')}</DropdownMenuItem>}
                          {u.id !== me?.id && <DropdownMenuSeparator />}
                          {u.id !== me?.id && (u.active
                            ? <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: 'deactivate', user: u })}><UserX className="h-4 w-4" /> {tr('Deactivate')}</DropdownMenuItem>
                            : <DropdownMenuItem onSelect={() => setConfirm({ kind: 'reactivate', user: u })}><UserCheck className="h-4 w-4" /> {tr('Reactivate')}</DropdownMenuItem>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager {...pg.props} />
        </>
      )}

      <FormDialog mode={form?.mode ?? null} user={form?.user ?? null} roles={assignable} onClose={() => setForm(null)} onDone={(c) => { if (c) setCreds(c); load() }} />
      <RoleDialog user={roleFor} roles={assignable} onClose={() => setRoleFor(null)} onDone={load} />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? `${text[confirm.kind].title.replace('this user', confirm.user.name).replace('this password', `${confirm.user.name}'s password`)}` : ''}</AlertDialogTitle>
            <AlertDialogDescription>{confirm && text[confirm.kind].body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); run() }}>{busy ? 'Working…' : confirm && text[confirm.kind].action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
