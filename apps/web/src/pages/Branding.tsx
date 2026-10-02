import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Trash2 } from 'lucide-react'
import { api, uploadFile } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { brandSwatch } from '@/lib/brand'
import { logoSrc } from '@/lib/tenant'
import { HueSlider } from '@/components/HueSlider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

interface School { id: string; slug: string | null; name: string; tagline: string | null; brandHue: number | null; logo: string | null; listLimit?: number; listLimitMin?: number; listLimitMax?: number }

/** How the school looks: name, tagline, accent colour and logo. Shown on the sign-in page and across the app. */
export function Branding() {
  const { t } = useT()
  const { reload } = useAuth()
  const [school, setSchool] = useState<School | null>(null)
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [hue, setHue] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const apply = (s: School) => { setSchool(s); setName(s.name); setTagline(s.tagline ?? ''); setHue(s.brandHue); setLimit(String(s.listLimit ?? '')) }
  useEffect(() => { api<School>('/school').then(apply).catch((e) => toast.error(e.message)) }, [])

  const dirty = !!school && (name !== school.name || tagline !== (school.tagline ?? '') || hue !== school.brandHue)

  const save = async () => {
    setBusy(true)
    try {
      apply(await api<School>('/school/branding', { method: 'PUT', body: { name, tagline, brandHue: hue } }))
      toast.success(t('Saved'))
      await reload() // the header and colours update straight away
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const min = school?.listLimitMin ?? 100, max = school?.listLimitMax ?? 5000
  const limitNum = Number(limit)
  const limitOk = Number.isInteger(limitNum) && limitNum >= min && limitNum <= max
  const saveLimit = async () => {
    setBusy(true)
    try {
      const r = await api<{ listLimit: number }>('/school/list-limit', { method: 'PUT', body: { listLimit: limitNum } })
      setSchool((s) => (s ? { ...s, listLimit: r.listLimit } : s)); setLimit(String(r.listLimit))
      toast.success(t('Saved'))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const pickLogo = async (f?: File) => {
    if (!f) return
    if (!/\.(png|jpe?g)$/i.test(f.name)) return toast.error(t('The logo must be a PNG or JPG picture'))
    if (f.size > 5 * 1024 * 1024) return toast.error(t('The logo must be under 5 MB'))
    setBusy(true)
    try { apply(await uploadFile<School>('/school/logo', f, undefined, true, 'PUT')); toast.success(t('Logo updated')); await reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const removeLogo = async () => {
    setBusy(true)
    try { apply(await api<School>('/school/logo', { method: 'DELETE' })); toast.success(t('Logo removed')); await reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (!school) return <p className="text-muted-foreground">{t('Loading…')}</p>
  const logo = logoSrc(school)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('School branding')}</h1>
        <p className="text-sm text-muted-foreground">{t('How your school looks on the sign-in page and across the app.')}</p>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <label className="block space-y-1 text-sm font-medium">{t('School name')}<Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block space-y-1 text-sm font-medium">{t('Tagline')} <span className="font-normal text-muted-foreground">{t('(shown under the name on the sign-in page)')}</span><Input value={tagline} maxLength={140} placeholder={t('e.g. Learning together')} onChange={(e) => setTagline(e.target.value)} /></label>
        <div className="space-y-1"><span className="text-sm font-medium">{t('Accent colour')}</span><HueSlider value={hue} onChange={setHue} /></div>
        <Button onClick={save} disabled={busy || !dirty || name.trim().length < 2}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">{t('Logo')}</h2>
        <div className="flex items-center gap-4">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
            {logo ? <img src={logo} alt={t('School logo')} className="h-full w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" />}
          </span>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('PNG or JPG, up to 5 MB. A square picture on a plain background works best.')}</p>
            <div className="flex gap-2">
              <input ref={file} type="file" hidden accept=".png,.jpg,.jpeg" onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = '' }} />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => file.current?.click()}>{logo ? 'Change logo' : 'Upload logo'}</Button>
              {logo && <Button variant="ghost" size="sm" disabled={busy} onClick={removeLogo}><Trash2 className="mr-1.5 h-4 w-4" /> {t('Remove')}</Button>}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">{t('Long lists')}</h2>
        <p className="text-xs text-muted-foreground">{t('The most rows that students, fees, admissions, certificates and leave requests load at once. A larger number shows more rows but makes those pages slower. When a list is cut off, a notice says so.')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm font-medium">{t('Rows per list')}
            <Input type="number" inputMode="numeric" className="w-32" min={min} max={max} step={100} value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!limitOk} />
          </label>
          <Button onClick={saveLimit} disabled={busy || !limitOk || limitNum === school.listLimit}>{t('Save')}</Button>
        </div>
        {!limitOk && <p className="text-xs text-destructive">{t('Enter a whole number from {min} to {max}.', { min, max })}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('Preview of your sign-in page')}</h2>
        <div className="max-w-sm space-y-3 rounded-xl border bg-card p-5">
          {logo && <img src={logo} alt="" className="h-12 w-12 rounded-lg object-contain" />}
          <div><p className="text-lg font-semibold">{name || 'Your school'}</p><p className="text-sm text-muted-foreground">{tagline || 'Sign in to your workspace'}</p></div>
          <div className="h-9 rounded-md border bg-background" />
          <div className="h-9 rounded-md" style={{ background: hue === null ? 'hsl(var(--primary))' : brandSwatch(hue) }} />
        </div>
      </section>
    </div>
  )
}
