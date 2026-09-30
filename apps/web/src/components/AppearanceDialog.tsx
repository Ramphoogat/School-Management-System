import { useRef } from 'react'
import { toast } from 'sonner'
import { Check, ImagePlus, Monitor, Moon, RotateCcw, Sun, X } from 'lucide-react'
import { PRESETS, WALLPAPERS, readWallpaper, useAppearance, wallpaperCss, type LegacyMode } from '@/lib/appearance'
import { useT } from '@/lib/i18n'
import { LanguagePicker } from '@/components/LanguagePicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const swatch = (hue: number, mode: 'light' | 'dark') =>
  mode === 'dark'
    ? `linear-gradient(135deg, hsl(${hue} 30% 9%) 50%, hsl(${hue} 85% 66%) 50%)`
    : `linear-gradient(135deg, hsl(${hue} 40% 96%) 50%, hsl(${hue} 70% 42%) 50%)`

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

const tile = (active: boolean) =>
  `relative flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition hover:bg-accent ${active ? 'border-primary ring-2 ring-primary/40' : ''}`

export function AppearanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { appearance: a, minDim, update, reset } = useAppearance()
  const { t } = useT()
  const file = useRef<HTMLInputElement>(null)

  const upload = async (f?: File) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast.error(t('Choose an image file'))
    try {
      const url = await readWallpaper(f)
      if (!update({ wallpaper: url })) toast.error(t('Image is too large to save. Try a smaller one.'))
    } catch (e) { toast.error((e as Error).message) }
  }

  const legacy: { id: LegacyMode; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: t('Light'), icon: Sun },
    { id: 'dark', label: t('Dark'), icon: Moon },
    { id: 'system', label: t('System'), icon: Monitor },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Appearance')}</DialogTitle>
          <DialogDescription>{t('Personalise your own dashboard. This is saved for you on this device.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Section title={t('Language')}>
            <LanguagePicker />
          </Section>

          <Section title={t('Colour theme')}>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => update({ theme: p.id })} aria-pressed={a.theme === p.id} className={tile(a.theme === p.id)}>
                  <span className="h-9 w-full rounded-md border" style={{ background: swatch(p.hue, p.mode) }} />
                  {t(p.name)}
                  {a.theme === p.id && <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
            <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${a.theme === 'custom' ? 'border-primary ring-2 ring-primary/40' : ''}`}>
              <span className="text-sm font-medium">{t('Your own colour')}</span>
              <input
                type="range" min={0} max={360} value={a.customHue}
                onChange={(e) => update({ theme: 'custom', customHue: Number(e.target.value) })}
                aria-label={t('Colour')}
                className="h-2 min-w-32 flex-1 cursor-pointer appearance-none rounded-full"
                style={{ background: 'linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 45%),hsl(180 80% 45%),hsl(240 80% 60%),hsl(300 80% 55%),hsl(360 80% 55%))' }}
              />
              <div className="flex overflow-hidden rounded-md border text-xs">
                {(['dark', 'light'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => update({ theme: 'custom', customMode: m })} aria-pressed={a.theme === 'custom' && a.customMode === m}
                    className={`px-2.5 py-1 capitalize ${a.theme === 'custom' && a.customMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                    {t(m)}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t('Wallpaper')} hint={t('A background behind your dashboard. Pick one or upload your own picture.')}>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
              <button type="button" onClick={() => update({ wallpaper: null })} aria-pressed={!a.wallpaper} className={tile(!a.wallpaper)}>
                <span className="flex h-9 w-full items-center justify-center rounded-md border bg-background"><X className="h-4 w-4 text-muted-foreground" /></span>
                {t('None')}
              </button>
              {WALLPAPERS.map((w) => (
                <button key={w.id} type="button" onClick={() => update({ wallpaper: w.id })} aria-pressed={a.wallpaper === w.id} className={tile(a.wallpaper === w.id)}>
                  <span className="h-9 w-full rounded-md border" style={{ background: w.css }} />
                  {t(w.name)}
                </button>
              ))}
              <button type="button" onClick={() => file.current?.click()} className={tile(!!a.wallpaper && !WALLPAPERS.some((w) => w.id === a.wallpaper))}>
                <span
                  className="flex h-9 w-full items-center justify-center rounded-md border bg-muted"
                  style={a.wallpaper && !WALLPAPERS.some((w) => w.id === a.wallpaper) ? { background: wallpaperCss(a.wallpaper) ?? undefined } : undefined}
                >
                  <ImagePlus className="h-4 w-4" />
                </span>
                {t('Upload')}
              </button>
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            {a.wallpaper && minDim > 0 && <p className="text-xs text-muted-foreground">{t('This picture needs at least {n}% dimming for text to stay readable.', { n: minDim })}</p>}
            {a.wallpaper && (
              <label className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0">{t('Text readability')}</span>
                <input type="range" min={minDim} max={100} value={Math.max(a.dim, minDim)} onChange={(e) => update({ dim: Number(e.target.value) })} className="flex-1 accent-primary" />
                <span className="w-9 text-right text-xs text-muted-foreground">{Math.max(a.dim, minDim)}%</span>
              </label>
            )}
          </Section>

          <Section title={t('Legacy')} hint={t('The original plain look. Choosing one turns off the colour theme above.')}>
            <div className="grid grid-cols-3 gap-2">
              {legacy.map((l) => (
                <button key={l.id} type="button" onClick={() => update({ theme: 'legacy', legacyMode: l.id })} aria-pressed={a.theme === 'legacy' && a.legacyMode === l.id}
                  className={tile(a.theme === 'legacy' && a.legacyMode === l.id)}>
                  <l.icon className="h-5 w-5" /> {l.label}
                </button>
              ))}
            </div>
          </Section>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="mr-1.5 h-4 w-4" /> {t('Reset to default')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
