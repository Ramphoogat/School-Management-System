import { brandSwatch } from '@/lib/brand'
import { useT } from '@/lib/i18n'

/** Pick an accent colour by hue. Empty (null) means "use the app's default colour". */
export function HueSlider({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useT()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range" min={0} max={360} value={value ?? 220} aria-label={t('Accent colour')}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full"
          style={{ background: 'linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 45%),hsl(180 80% 45%),hsl(240 80% 60%),hsl(300 80% 55%),hsl(360 80% 55%))', opacity: value === null ? 0.45 : 1 }}
        />
        <span className="h-8 w-8 shrink-0 rounded-full border" style={{ background: value === null ? 'transparent' : brandSwatch(value) }} aria-hidden />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{value === null ? 'Using the default colour' : 'Custom colour'}</span>
        {value !== null && <button type="button" className="underline" onClick={() => onChange(null)}>{t('Use the default')}</button>}
      </div>
    </div>
  )
}
