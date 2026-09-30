import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'

type Variant = 'normal' | 'urgent'
interface Wording { subject: string; body: string; custom: boolean; default: { subject: string; body: string } }
interface Template { event: string; label: string; audience: string; vars: { name: string; help: string; sample: string }[]; urgentWhen: string | null; normal: Wording; urgent: Wording | null }

const PLACEHOLDER = /\{(\w+)\}/g
const fill = (text: string, samples: Record<string, string>) => text.replace(PLACEHOLDER, (_, n: string) => samples[n] ?? '')
const unknown = (text: string, allowed: Set<string>) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !allowed.has(n)))]

/** The school's own wording for each notification. Only the admin gets here. */
export function NotificationTemplates() {
  const { t: tr } = useT()
  const [list, setList] = useState<Template[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(() => api<Template[]>('/notifications/templates').then(setList).catch((e) => { toast.error(e.message); setList([]) }), [])
  useEffect(() => { void load() }, [load])

  const current = list?.find((t) => t.event === editing) ?? null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{tr('Message templates')}</h1>
        <p className="text-sm text-muted-foreground">{tr('The wording of every message the school sends by email, WhatsApp and in the app. Change any of them here. The defaults stay available if you want to go back.')}</p>
      </div>

      {list === null ? <p className="text-sm text-muted-foreground">{tr('Loading…')}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const changed = t.normal.custom || !!t.urgent?.custom
            return (
              <button key={t.event} type="button" onClick={() => setEditing(t.event)} className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 hover:shadow-md">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{t.label}</span>
                  {changed && <Badge>{tr('Changed')}</Badge>}
                  {t.urgent && <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> {tr('Has urgent wording')}</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{tr('To: {audience}', { audience: t.audience })}</span>
                <span className="line-clamp-2 text-sm text-muted-foreground">{t.normal.subject}</span>
              </button>
            )
          })}
        </div>
      )}

      <Editor template={current} onClose={() => setEditing(null)} onChanged={load} />
    </div>
  )
}

function Editor({ template, onClose, onChanged }: { template: Template | null; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const { t } = useT()
  const [variant, setVariant] = useState<Variant>('normal')
  const [draft, setDraft] = useState<Record<Variant, { subject: string; body: string }>>({ normal: { subject: '', body: '' }, urgent: { subject: '', body: '' } })
  const [busy, setBusy] = useState(false)
  const focus = useRef<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!template) return
    setVariant('normal')
    setDraft({
      normal: { subject: template.normal.subject, body: template.normal.body },
      urgent: template.urgent ? { subject: template.urgent.subject, body: template.urgent.body } : { subject: '', body: '' },
    })
  }, [template])

  const wording = template ? (variant === 'urgent' ? template.urgent : template.normal) : null
  const d = draft[variant]
  const allowed = useMemo(() => new Set(template?.vars.map((v) => v.name) ?? []), [template])
  const samples = useMemo(() => Object.fromEntries(template?.vars.map((v) => [v.name, v.sample]) ?? []), [template])
  const bad = [...unknown(d.subject, allowed), ...unknown(d.body, allowed)]
  const dirty = !!wording && (d.subject !== wording.subject || d.body !== wording.body)
  const set = (patch: Partial<{ subject: string; body: string }>) => setDraft((x) => ({ ...x, [variant]: { ...x[variant], ...patch } }))

  /** Drop a placeholder in at the cursor of whichever box was last used. */
  const insert = (name: string) => {
    const field = focus.current
    const el = field === 'subject' ? subjectRef.current : bodyRef.current
    const text = `{${name}}`
    const value = field === 'subject' ? d.subject : d.body
    const start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length
    const next = value.slice(0, start) + text + value.slice(end)
    set(field === 'subject' ? { subject: next } : { body: next })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length) })
  }

  const save = async () => {
    if (!template) return
    setBusy(true)
    try {
      await api(`/notifications/templates/${template.event}/${variant}`, { method: 'PUT', body: { subject: d.subject, body: d.body } })
      toast.success(t('Saved. New messages use this wording.'))
      await onChanged()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const reset = async () => {
    if (!template || !window.confirm(t('Go back to the default wording for this message?'))) return
    setBusy(true)
    try { await api(`/notifications/templates/${template.event}/${variant}`, { method: 'DELETE' }); toast.success(t('Back to the default')); await onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template?.label}</DialogTitle>
          <DialogDescription>{t('To: {audience}', { audience: template?.audience })}</DialogDescription>
        </DialogHeader>

        {template?.urgent && (
          <div className="flex gap-1" role="tablist" aria-label={t('Wording')}>
            {(['normal', 'urgent'] as Variant[]).map((v) => (
              <Button key={v} role="tab" aria-selected={variant === v} size="sm" variant={variant === v ? 'default' : 'outline'} className="capitalize" onClick={() => setVariant(v)}>{v}{(v === 'urgent' ? template.urgent?.custom : template.normal.custom) ? ' (changed)' : ''}</Button>
            ))}
          </div>
        )}
        {variant === 'urgent' && template?.urgent && (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <strong>{t('Used when:')}</strong> {template.urgentWhen} Urgent messages ignore people&apos;s quiet hours and are sent first.
          </p>
        )}

        <div className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">{t('Subject')}<Input ref={subjectRef} value={d.subject} maxLength={150} onFocus={() => { focus.current = 'subject' }} onChange={(e) => set({ subject: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm font-medium">{t('Message')}<Textarea ref={bodyRef} rows={5} value={d.body} maxLength={1500} onFocus={() => { focus.current = 'body' }} onChange={(e) => set({ body: e.target.value })} />
          </label>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('Click to add a detail that is filled in for each person:')}</p>
            <div className="flex flex-wrap gap-1.5">
              {template?.vars.map((v) => (
                <button key={v.name} type="button" title={`${v.help} (for example: ${v.sample})`} onClick={() => insert(v.name)} className="rounded-full border bg-muted px-2.5 py-1 font-mono text-xs transition hover:bg-accent">{`{${v.name}}`}</button>
              ))}
            </div>
          </div>
          {bad.length > 0 && <p className="text-sm text-destructive">{t('Not available here: {value}. Use only the details above.', { value: bad.map((b) => `{${b}}`).join(', ') })}</p>}
        </div>

        <div className="space-y-1 rounded-lg border bg-muted/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Preview with example details')}</p>
          <p className="font-medium">{fill(d.subject, samples) || <span className="text-muted-foreground">{t('(no subject)')}</span>}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{fill(d.body, samples)}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={busy || !wording?.custom} onClick={reset}><RotateCcw className="mr-1.5 h-4 w-4" /> {t('Use the default')}</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('Close')}</Button>
            <Button disabled={busy || !dirty || bad.length > 0 || !d.subject.trim() || !d.body.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
