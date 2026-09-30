import { Languages } from 'lucide-react'
import { LANGUAGES, useT, type Lang } from '@/lib/i18n'

/** Chooses the interface language. Each language is named in its own script so people can find theirs. */
export function LanguagePicker({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useT()
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <Languages className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t('Language')}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        lang={lang}
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
      </select>
    </label>
  )
}
