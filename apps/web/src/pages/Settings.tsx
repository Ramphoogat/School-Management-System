import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, tokens } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pager, usePaged } from '@/components/Pager'
import { useT } from '@/lib/i18n'

type Channel = 'email' | 'whatsapp' | 'in_app'
const LABEL: Record<Channel, string> = { email: 'Email', whatsapp: 'WhatsApp', in_app: 'In-app' }

export function NotificationSettings() {
  const { t } = useT()
  const [prefs, setPrefs] = useState<Record<Channel, boolean> | null>(null)
  const [phone, setPhone] = useState('')
  const [optIn, setOptIn] = useState(false)

  useEffect(() => {
    api<{ channels: Record<Channel, boolean>; phone: string; whatsappOptIn: boolean }>('/notifications/preferences').then((p) => {
      setPrefs(p.channels); setPhone(p.phone); setOptIn(p.whatsappOptIn)
    })
  }, [])

  const setChannel = async (channel: Channel, enabled: boolean) => {
    setPrefs((p) => p && { ...p, [channel]: enabled })
    try { await api('/notifications/preferences', { method: 'PUT', body: { channel, enabled } }) }
    catch (e) { toast.error((e as Error).message); setPrefs((p) => p && { ...p, [channel]: !enabled }) }
  }

  const saveProfile = async () => {
    try {
      await api('/notifications/profile', { method: 'PUT', body: { phone, whatsappOptIn: optIn } })
      toast.success(t('Saved'))
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-8">
      <ChangePassword />
      <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">{t('Notification settings')}</h1>
      <section className="space-y-3">
        <h2 className="font-medium">{t('How you want to be notified')}</h2>
        {prefs && (Object.keys(LABEL) as Channel[]).map((c) => (
          <label key={c} className="flex items-center justify-between rounded-md border p-3 text-sm">
            {LABEL[c]}
            <Switch checked={prefs[c]} onCheckedChange={(v) => setChannel(c, v)} />
          </label>
        ))}
      </section>
      <QuietHours />
      <section className="space-y-3">
        <h2 className="font-medium">{t('WhatsApp')}</h2>
        <Input placeholder={t('Phone with country code, e.g. +91 98765 43210')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="flex items-center justify-between rounded-md border p-3 text-sm">
          {t('I agree to receive school messages on WhatsApp')}<Switch checked={optIn} onCheckedChange={setOptIn} />
        </label>
        <Button onClick={saveProfile} disabled={optIn && !phone.trim()}>{t('Save')}</Button>
        {optIn && !phone.trim() && <p className="text-xs text-muted-foreground">{t('Add a phone number to receive WhatsApp messages.')}</p>}
      </section>
      </div>
    </div>
  )
}

interface Quiet { enabled: boolean; start: string; end: string; timezone: string }

/** Email and WhatsApp wait until quiet hours end. In-app alerts and urgent messages do not wait. */
function QuietHours() {
  const { t } = useT()
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [saved, setSaved] = useState<Quiet | null>(null)
  const [q, setQ] = useState<Quiet | null>(null)
  const [busy, setBusy] = useState(false)
  const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return [] } })()

  useEffect(() => {
    api<Quiet>('/notifications/quiet-hours').then((r) => { const v = { ...r, timezone: r.timezone || detected }; setSaved(v); setQ(v) })
  }, [detected])

  const dirty = !!q && !!saved && JSON.stringify(q) !== JSON.stringify(saved)
  const save = async () => {
    if (!q) return
    setBusy(true)
    try { await api('/notifications/quiet-hours', { method: 'PUT', body: q }); setSaved(q); toast.success(t('Quiet hours saved')) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  if (!q) return null

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t('Quiet hours')}</h2>
      <label className="flex items-center justify-between rounded-md border p-3 text-sm">
        {t('Hold email and WhatsApp during quiet hours')}<Switch checked={q.enabled} onCheckedChange={(v) => setQ({ ...q, enabled: v })} />
      </label>
      {q.enabled && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">{t('From')}<Input type="time" value={q.start} onChange={(e) => setQ({ ...q, start: e.target.value })} className="w-32" /></label>
            <label className="space-y-1 text-sm">{t('Until')}<Input type="time" value={q.end} onChange={(e) => setQ({ ...q, end: e.target.value })} className="w-32" /></label>
          </div>
          <label className="block space-y-1 text-sm">{t('Your timezone')}<select className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={q.timezone} onChange={(e) => setQ({ ...q, timezone: e.target.value })}>
              {[...new Set([q.timezone, detected, ...zones])].map((z) => <option key={z} value={z}>{z}{z === detected ? ' (this device)' : ''}</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('Messages that arrive in this time are sent when it ends. Alerts inside the app still appear straight away, and urgent messages (such as an urgent announcement or a long-overdue fee) always come through.')}</p>
      <Button onClick={save} disabled={!dirty || busy || (q.enabled && q.start === q.end)}>{busy ? 'Saving…' : 'Save quiet hours'}</Button>
      {q.enabled && q.start === q.end && <p className="text-xs text-destructive">{t('The start and end times must be different.')}</p>}
    </section>
  )
}

export function DeliveryLog() {
  const { t } = useT()
  const [rows, setRows] = useState<any[]>([])
  const pg_rows = usePaged(rows)
  const load = useCallback(() => api<any[]>('/notifications/log').then(setRows), [])
  useEffect(() => { load() }, [load])
  const variant = (s: string) => (s === 'failed' ? 'destructive' : s === 'sent' ? 'default' : 'secondary')
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('Delivery log')}</h1>
        <Button variant="outline" size="sm" onClick={load}>{t('Refresh')}</Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">{t('No email or WhatsApp messages yet.')}</p>
      ) : (
        <>
<Table>
          <TableHeader><TableRow><TableHead>{t('When')}</TableHead><TableHead>{t('To')}</TableHead><TableHead>{t('Channel')}</TableHead><TableHead>{t('Subject')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead>{t('Detail')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {pg_rows.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{r.to}</TableCell>
                <TableCell className="capitalize">{r.channel}</TableCell>
                <TableCell>{r.subject}{r.urgent && <Badge variant="destructive" className="ml-2">{t('Urgent')}</Badge>}</TableCell>
                <TableCell><Badge variant={variant(r.status)} className="capitalize">{r.status}</Badge></TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={r.error ?? ''}>{r.error ?? (r.scheduledFor ? `Held for quiet hours until ${new Date(r.scheduledFor).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : r.attempts ? `${r.attempts} attempt(s)` : '')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
<Pager {...pg_rows.props} />
</>
      )}
    </div>
  )
}

export function ChangePassword() {
  const { t } = useT()
  const { reload, logout } = useAuth()
  const signOutEverywhere = async () => {
    try { await api('/auth/logout-all', { method: 'POST', body: {} }); logout() } catch (e) { toast.error((e as Error).message) }
  }
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/change-password', { body: { currentPassword: cur, newPassword: next } })
      tokens.set(r.accessToken, r.refreshToken) // other devices are signed out; this one continues
      toast.success(t('Password changed')); setCur(''); setNext(''); await reload()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="max-w-md space-y-3">
      <h2 className="font-medium">{t('Change password')}</h2>
      <Input type="password" placeholder={t('Current password')} value={cur} onChange={(e) => setCur(e.target.value)} />
      <Input type="password" placeholder={t('New password (8+ characters)')} value={next} onChange={(e) => setNext(e.target.value)} />
      <Button onClick={submit} disabled={busy || !cur || next.length < 8}>{t('Change password')}</Button>
      <p className="text-xs text-muted-foreground">{t('Changing your password signs you out of every other device.')}</p>
      <Button variant="outline" onClick={signOutEverywhere}>{t('Sign out of all devices')}</Button>
    </section>
  )
}
