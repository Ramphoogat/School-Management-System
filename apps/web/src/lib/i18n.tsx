import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Interface languages. The English text in the code is the key: `t('Sign in')` returns the translation when there is one
 * and the English text otherwise, so a screen that has not been translated yet still works. Dictionaries load on demand.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'mr', name: 'मराठी' },
  { code: 'bgc', name: 'हरियाणवी' },
] as const
export type Lang = (typeof LANGUAGES)[number]['code']

type Dict = Record<string, string>
/** Each language is two files: the core (sign-in, menus, home) and the rest of the screens. Both load together. */
const both = (core: () => Promise<{ default: Dict }>, screens: () => Promise<{ default: Dict }>) => async () => ({ default: { ...(await core()).default, ...(await screens()).default } })
const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  hi: both(() => import('./i18n/hi'), () => import('./i18n/hi-screens')),
  te: both(() => import('./i18n/te'), () => import('./i18n/te-screens')),
  ta: both(() => import('./i18n/ta'), () => import('./i18n/ta-screens')),
  mr: both(() => import('./i18n/mr'), () => import('./i18n/mr-screens')),
  // Haryanvi: the Hindi translations with Haryanvi wording laid over them
  bgc: async () => ({ default: { ...(await import('./i18n/hi')).default, ...(await import('./i18n/hi-screens')).default, ...(await import('./i18n/bgc')).default } }),
}

const NO_WORDS: Dict = {}
const KEY = 'language'
const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v)

/** The saved choice, else the browser's language if we have it, else English. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (isLang(saved)) return saved
  } catch { /* storage blocked: fall through */ }
  const browser = (navigator.language ?? 'en').slice(0, 2).toLowerCase()
  return isLang(browser) ? browser : 'en'
}

export type T = (msg: string, vars?: Record<string, string | number | null | undefined>) => string

interface Ctx { lang: Lang; /** For dates and numbers: browsers do not know every language code (Haryanvi), so it borrows Hindi. */ locale: string; setLang: (l: Lang) => void; t: T }
const LangCtx = createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [loaded, setLoaded] = useState<{ lang: Lang; dict: Dict } | null>(null)
  const dict = loaded && loaded.lang === lang ? loaded.dict : NO_WORDS // English, or a new language still loading

  useEffect(() => {
    document.documentElement.lang = lang // screen readers pick the right voice from this
    if (lang === 'en') return
    let live = true
    loaders[lang]().then((m) => { if (live) setLoaded({ lang, dict: m.default }) }).catch(() => undefined) // a failed load leaves English showing
    return () => { live = false }
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(KEY, l) } catch { /* not saved; still applies for this visit */ }
  }, [])

  const t = useCallback<T>((msg, vars) => {
    const s = dict[msg] ?? msg
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m)) : s
  }, [dict])

  const value = useMemo(() => ({ lang, locale: lang === 'bgc' ? 'hi' : lang, setLang, t }), [lang, setLang, t])
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>
}

export function useT() {
  const c = useContext(LangCtx)
  if (!c) throw new Error('useT outside LanguageProvider')
  return c
}
