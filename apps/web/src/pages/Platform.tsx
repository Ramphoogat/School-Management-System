import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Building2, Copy, ExternalLink, KeyRound, Plus, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { brandSwatch } from '@/lib/brand'
import { logoSrc, signInAddress } from '@/lib/tenant'
import { HueSlider } from '@/components/HueSlider'
import { BillingBadge, BillingSection, DeleteSchool, PlansManager, type BillingStatus } from '@/pages/PlatformBilling'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/lib/i18n'

interface SchoolRow { id: string; slug: string | null; name: string; tagline: string | null; brandHue: number | null; logo: string | null; active: boolean; people: number; students: number; teachers: number; plan: { id: string; name: string; maxStudents: number } | null; planEndsOn: string | null; billing: BillingStatus }
interface Admin { id: string; name: string; email: string; active: boolean; mustChangePassword: boolean }
interface Detail extends SchoolRow { admins: Admin[] }
type Creds = { title: string; name: string; email: string; password: string; address: string | null }

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

function CredentialsDialog({ creds, onClose }: { creds: Creds | null; onClose: () => void }) {
  const { t } = useT()
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('Copied')) } catch { toast.error(t('Could not copy. Select it and copy by hand.')) } }
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{creds?.title}</DialogTitle><DialogDescription>{t('Give these sign-in details to {name}. The password is shown only once.', { name: creds?.name })}</DialogDescription></DialogHeader>
        <dl className="space-y-3 rounded-lg border bg-muted p-3 text-sm">
          {creds?.address && <div><dt className="text-xs text-muted-foreground">{t('Sign-in address')}</dt><dd className="break-all font-medium">{creds.address}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">{t('Email')}</dt><dd className="font-medium">{creds?.email}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('Temporary password')}</dt>
            <dd className="flex items-center justify-between gap-2"><code className="select-all break-all font-mono text-base">{creds?.password}</code><Button size="sm" variant="outline" onClick={() => creds && copy(creds.password)}><Copy className="mr-1.5 h-4 w-4" /> {t('Copy')}</Button></dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('They choose their own password the first time they sign in.')}</p>
        <div className="flex justify-end"><Button onClick={onClose}>{t('Done')}</Button></div>
      </DialogContent>
    </Dialog>
  )
}

function AddSchool({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (c: Creds) => void }) {
  const { t } = useT()
  const [f, setF] = useState({ name: '', slug: '', adminName: '', adminEmail: '', tagline: '' })
  const [hue, setHue] = useState<number | null>(null)
  const [touched, setTouched] = useState(false) // once the address is typed by hand, stop following the name
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setF({ name: '', slug: '', adminName: '', adminEmail: '', tagline: '' }); setHue(null); setTouched(false) } }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ school: { slug: string; name: string }; admin: { name: string; email: string }; tempPassword: string }>('/platform/schools', { body: { name: f.name, slug: f.slug, adminName: f.adminName, adminEmail: f.adminEmail, tagline: f.tagline || undefined, brandHue: hue ?? undefined } })
      toast.success(`${r.school.name} created`)
      onDone({ title: 'School created', name: r.admin.name, email: r.admin.email, password: r.tempPassword, address: signInAddress(r.school.slug) })
      onClose()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('Add a school')}</DialogTitle><DialogDescription>{t('This creates the school and its first admin, who then sets everything else up.')}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">{t('School name')}<Input value={f.name} maxLength={80} required autoFocus onChange={(e) => setF({ ...f, name: e.target.value, slug: touched ? f.slug : slugify(e.target.value) })} /></label>
          <label className="block space-y-1 text-sm font-medium">{t('Address')} <span className="font-normal text-muted-foreground">{t('(its own sign-in link)')}</span>
            <Input value={f.slug} maxLength={40} required placeholder="greenfield" onChange={(e) => { setTouched(true); setF({ ...f, slug: e.target.value.toLowerCase() }) }} />
            {f.slug && <span className="block text-xs font-normal text-muted-foreground">{signInAddress(f.slug)}</span>}
          </label>
          <label className="block space-y-1 text-sm font-medium">{t('Tagline')} <span className="font-normal text-muted-foreground">{t('(optional)')}</span><Input value={f.tagline} maxLength={140} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></label>
          <div className="space-y-1"><span className="text-sm font-medium">{t('Accent colour')}</span><HueSlider value={hue} onChange={setHue} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm font-medium">{t('First admin\'s name')}<Input value={f.adminName} required maxLength={80} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></label>
            <label className="block space-y-1 text-sm font-medium">{t('First admin\'s email')}<Input type="email" value={f.adminEmail} required onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></label>
          </div>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create school'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SchoolPanel({ id, onClose, onChanged, onCreds }: { id: string | null; onClose: () => void; onChanged: () => void; onCreds: (c: Creds) => void }) {
  const { t } = useT()
  const [d, setD] = useState<Detail | null>(null)
  const [f, setF] = useState({ name: '', slug: '', tagline: '' })
  const [hue, setHue] = useState<number | null>(null)
  const [adm, setAdm] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const r = await api<Detail>(`/platform/schools/${id}`)
    setD(r); setF({ name: r.name, slug: r.slug ?? '', tagline: r.tagline ?? '' }); setHue(r.brandHue)
  }, [id])
  useEffect(() => { setD(null); setAdm({ name: '', email: '' }); load().catch((e) => toast.error(e.message)) }, [load])

  const dirty = !!d && (f.name !== d.name || f.slug !== (d.slug ?? '') || f.tagline !== (d.tagline ?? '') || hue !== d.brandHue)
  const save = async () => {
    setBusy(true)
    try { await api(`/platform/schools/${id}`, { method: 'PATCH', body: { name: f.name, slug: f.slug, tagline: f.tagline, brandHue: hue } }); toast.success(t('Saved')); await load(); onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const addAdmin = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ admin: { name: string; email: string }; tempPassword: string }>(`/platform/schools/${id}/admins`, { body: adm })
      onCreds({ title: 'Admin added', name: r.admin.name, email: r.admin.email, password: r.tempPassword, address: d?.slug ? signInAddress(d.slug) : null })
      setAdm({ name: '', email: '' }); await load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  const reset = async (a: Admin) => {
    if (!window.confirm(`Reset the password for ${a.name}? Their old password stops working.`)) return
    try {
      const r = await api<{ admin: { name: string; email: string }; tempPassword: string }>(`/platform/schools/${id}/admins/${a.id}/reset-password`, { body: {} })
      onCreds({ title: 'Password reset', name: r.admin.name, email: r.admin.email, password: r.tempPassword, address: d?.slug ? signInAddress(d.slug) : null })
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4"><SheetTitle>{d?.name ?? 'School'}</SheetTitle><SheetDescription>{d ? `${d.people} people · ${d.students} students · ${d.teachers} teachers` : 'Loading…'}</SheetDescription></SheetHeader>
        {d && (
          <div className="space-y-6 p-4">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">{t('Details')}</h3>
              <label className="block space-y-1 text-sm font-medium">{t('Name')}<Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label className="block space-y-1 text-sm font-medium">{t('Address')}<Input value={f.slug} maxLength={40} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
                <span className="block text-xs font-normal text-muted-foreground">{t('Changing it changes the school\'s sign-in link. Tell them if you do.')}</span></label>
              <label className="block space-y-1 text-sm font-medium">{t('Tagline')}<Input value={f.tagline} maxLength={140} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></label>
              <div className="space-y-1"><span className="text-sm font-medium">{t('Accent colour')}</span><HueSlider value={hue} onChange={setHue} /></div>
              <Button onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Button>
            </section>

            <BillingSection id={d.id} onChanged={onChanged} />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('Admins')}</h3>
              <ul className="divide-y rounded-lg border">
                {d.admins.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 p-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-xs text-muted-foreground">{a.email}{a.mustChangePassword ? ' · has not signed in yet' : ''}</span></span>
                    {!a.active && <Badge variant="destructive">{t('Deactivated')}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => reset(a)}><KeyRound className="mr-1.5 h-4 w-4" /> {t('Reset password')}</Button>
                  </li>
                ))}
                {d.admins.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('No admins yet.')}</li>}
              </ul>
              <form onSubmit={addAdmin} className="space-y-2 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium"><UserPlus className="h-4 w-4" /> {t('Add another admin')}</p>
                <div className="grid gap-2 sm:grid-cols-2"><Input placeholder={t('Name')} value={adm.name} required minLength={2} onChange={(e) => setAdm({ ...adm, name: e.target.value })} /><Input type="email" placeholder={t('Email')} value={adm.email} required onChange={(e) => setAdm({ ...adm, email: e.target.value })} /></div>
                <Button type="submit" size="sm" disabled={busy}>{t('Add admin')}</Button>
              </form>
            </section>

            <DeleteSchool school={d} onDeleted={() => { onClose(); onChanged() }} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The platform's super admin: every school, who runs it, and whether it is switched on. Never a school's own records. */
export function Platform() {
  const { t } = useT()
  const [rows, setRows] = useState<SchoolRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creds, setCreds] = useState<Creds | null>(null)
  const [suspend, setSuspend] = useState<SchoolRow | null>(null)

  const load = useCallback(() => api<SchoolRow[]>('/platform/schools').then(setRows).catch((e) => { toast.error(e.message); setRows([]) }), [])
  useEffect(() => { void load() }, [load])

  const setActive = async (s: SchoolRow, active: boolean) => {
    try { await api(`/platform/schools/${s.id}`, { method: 'PATCH', body: { active } }); toast.success(active ? `${s.name} is back on` : `${s.name} is suspended`); setSuspend(null); await load() }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Building2 className="h-6 w-6" /> {t('Schools')}</h1><p className="text-sm text-muted-foreground">{rows ? `${rows.length} school${rows.length === 1 ? '' : 's'} on the platform` : 'Loading…'}</p></div>
        <Button onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" /> {t('Add school')}</Button>
      </div>

      {rows && rows.length === 0 && <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No schools yet. Add the first one.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows?.map((s) => (
          <article key={s.id} className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${s.active ? '' : 'opacity-70'}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted" style={s.brandHue !== null ? { borderColor: brandSwatch(s.brandHue) } : undefined}>
                {s.logo ? <img src={logoSrc(s)!} alt="" className="h-full w-full object-contain" /> : <span className="text-sm font-semibold">{s.name.slice(0, 2).toUpperCase()}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.slug ?? 'no address yet'}</p>
              </div>
              {s.active ? <Badge>{t('Active')}</Badge> : <Badge variant="destructive">{t('Suspended')}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{t('{people} people · {students} students · {teachers} teachers', { people: s.people, students: s.students, teachers: s.teachers })}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <BillingBadge status={s.billing} />
              {s.plan ? `${s.plan.name}${s.plan.maxStudents ? ` · ${s.students} of ${s.plan.maxStudents} students` : ' · unlimited students'}${s.planEndsOn ? ` · paid to ${s.planEndsOn}` : ''}` : 'No plan, so no limits'}
            </p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpenId(s.id)}>{t('Manage')}</Button>
              {s.slug && <Button size="sm" variant="ghost" asChild><a href={signInAddress(s.slug)} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> {t('Sign-in page')}</a></Button>}
              {s.active ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setSuspend(s)}>{t('Suspend')}</Button> : <Button size="sm" variant="ghost" onClick={() => setActive(s, true)}>{t('Reactivate')}</Button>}
            </div>
          </article>
        ))}
      </div>

      <PlansManager />

      <AddSchool open={adding} onClose={() => setAdding(false)} onDone={(c) => { setCreds(c); void load() }} />
      <SchoolPanel id={openId} onClose={() => setOpenId(null)} onChanged={load} onCreds={setCreds} />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />

      <AlertDialog open={!!suspend} onOpenChange={(o) => !o && setSuspend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Suspend {name}?', { name: suspend?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('Everyone at this school is signed out straight away and cannot sign in until you reactivate it. Nothing is deleted.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t('Cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => suspend && setActive(suspend, false)}>{t('Suspend')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
