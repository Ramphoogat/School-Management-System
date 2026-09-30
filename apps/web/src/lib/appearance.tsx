import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from './auth'
import { BRAND_VARS, brandVars } from './brand'
import { useTenant } from './tenant'
import { palette } from './palette'
import { minDim as leastDim, type Hsl } from './contrast.ts'
import { gradientColours, pictureColours } from './wallpaperContrast.ts'

export type Mode = 'light' | 'dark'
export type LegacyMode = 'light' | 'dark' | 'system'

export interface ThemePreset { id: string; name: string; hue: number; mode: Mode }

export const PRESETS: ThemePreset[] = [
  { id: 'ocean', name: 'Ocean', hue: 210, mode: 'dark' },
  { id: 'forest', name: 'Forest', hue: 150, mode: 'dark' },
  { id: 'sunset', name: 'Sunset', hue: 18, mode: 'dark' },
  { id: 'violet', name: 'Violet', hue: 265, mode: 'dark' },
  { id: 'rose', name: 'Rose', hue: 340, mode: 'dark' },
  { id: 'sky', name: 'Sky', hue: 200, mode: 'light' },
  { id: 'mint', name: 'Mint', hue: 160, mode: 'light' },
  { id: 'sand', name: 'Sand', hue: 38, mode: 'light' },
]

export const WALLPAPERS: { id: string; name: string; css: string }[] = [
  { id: 'aurora', name: 'Aurora', css: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(135deg,#41295a,#2f0743)' },
  { id: 'peach', name: 'Peach', css: 'linear-gradient(135deg,#ff9a9e,#fad0c4)' },
  { id: 'meadow', name: 'Meadow', css: 'linear-gradient(135deg,#11998e,#38ef7d)' },
  { id: 'ocean', name: 'Deep sea', css: 'linear-gradient(135deg,#0575e6,#021b79)' },
  { id: 'mist', name: 'Mist', css: 'linear-gradient(135deg,#e0eafc,#cfdef3)' },
]

export interface Appearance {
  /** 'legacy' = plain light/dark/system, 'custom' = user's own hue, otherwise a preset id. */
  theme: string
  legacyMode: LegacyMode
  customHue: number
  customMode: Mode
  /** A wallpaper preset id, a data: URL of an uploaded image, or null. */
  wallpaper: string | null
  /** 0-100: how strongly the page colour is laid over the wallpaper so text stays readable. */
  dim: number
}

const DEFAULT: Appearance = { theme: 'legacy', legacyMode: 'system', customHue: 250, customMode: 'dark', wallpaper: null, dim: 55 }
const KEY = (id: string) => `appearance:${id}`
/** Before anyone signs in (the sign-in page) the look is kept for the device instead of a person. */
const GUEST_KEY = 'appearance:guest'
const storageKey = (userId?: string) => (userId ? KEY(userId) : GUEST_KEY)

export function wallpaperCss(w: string | null): string | null {
  if (!w) return null
  const preset = WALLPAPERS.find((x) => x.id === w)
  if (preset) return preset.css
  return w.startsWith('data:image/') ? `url("${w}") center / cover no-repeat` : null
}

/** Downscale an uploaded image so it fits comfortably in localStorage. */
export function readWallpaper(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

interface Ctx {
  appearance: Appearance
  /** The least dimming (percent) at which text stays readable on the current wallpaper and theme. */
  minDim: number
  update: (patch: Partial<Appearance>) => boolean
  reset: () => void
}
const AppearanceCtx = createContext<Ctx | null>(null)

const VAR_NAMES = Object.keys(palette(0, 'dark'))

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { setTheme, resolvedTheme } = useTheme()
  const tenant = useTenant()
  // Signed in: the school's own colour. On the sign-in page: the colour of the school whose address it is.
  const brandHue = user ? user.school?.brandHue ?? null : tenant.brand?.brandHue ?? null
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT)

  // Load this user's saved look on sign-in, or the device's look on the sign-in page. A person who has never
  // customised anything starts from the look chosen on the sign-in page, so it does not vanish when they sign in.
  useEffect(() => {
    try {
      let raw = localStorage.getItem(storageKey(user?.id))
      if (!raw && user) {
        raw = localStorage.getItem(GUEST_KEY)
        if (raw) localStorage.setItem(KEY(user.id), raw)
      }
      setAppearance(raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT)
    } catch { setAppearance(DEFAULT) }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // How much dimming the wallpaper needs so that text stays readable (4.5:1) on it, in this theme. Measured after the theme
  // is applied, because the answer depends on the theme's own text and page colours. The user's slider cannot go below it.
  const measureKey = [appearance.wallpaper?.length, appearance.wallpaper?.slice(0, 40), appearance.theme, appearance.customHue, appearance.customMode, appearance.legacyMode, resolvedTheme].join('|')
  const [measured, setMeasured] = useState<{ key: string; dim: number }>({ key: '', dim: 0 })
  useEffect(() => {
    const wp = appearance.wallpaper
    if (!wp) return
    let live = true
    const frame = requestAnimationFrame(async () => {
      const css = getComputedStyle(document.documentElement)
      const colour = (name: string): Hsl => { const [h, sat, l] = css.getPropertyValue(name).replace(/%/g, '').trim().split(/\s+/).map(Number); return [h || 0, sat || 0, l || 0] }
      const preset = WALLPAPERS.find((x) => x.id === wp)
      const pixels = preset ? gradientColours(preset.css) : await pictureColours(wp)
      if (!live || pixels.length === 0) return
      const dim = Math.ceil(leastDim([colour('--foreground'), colour('--muted-foreground')], colour('--background'), pixels) * 100)
      if (live) setMeasured({ key: measureKey, dim })
    })
    return () => { live = false; cancelAnimationFrame(frame) }
  }, [appearance.wallpaper, measureKey])
  const minDim = appearance.wallpaper && measured.key === measureKey ? measured.dim : 0

  // Apply to the document.
  useEffect(() => {
    const root = document.documentElement
    const preset = PRESETS.find((p) => p.id === appearance.theme)
    const colored = appearance.theme === 'custom' ? { hue: appearance.customHue, mode: appearance.customMode } : preset ? { hue: preset.hue, mode: preset.mode } : null
    if (colored) {
      const vars = palette(colored.hue, colored.mode)
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
      setTheme(colored.mode) // keeps the `dark` class in step with the palette
    } else {
      for (const k of VAR_NAMES) root.style.removeProperty(k)
      for (const k of BRAND_VARS) root.style.removeProperty(k)
      if (brandHue !== null) for (const [k, v] of Object.entries(brandVars(brandHue, resolvedTheme === 'dark'))) root.style.setProperty(k, v)
      setTheme(appearance.legacyMode)
    }
    const wp = wallpaperCss(appearance.wallpaper)
    if (wp) { root.dataset.wallpaper = 'on'; root.style.setProperty('--wallpaper', wp); root.style.setProperty('--wallpaper-dim', String(Math.max(appearance.dim, minDim) / 100)) }
    else { delete root.dataset.wallpaper; root.style.removeProperty('--wallpaper'); root.style.removeProperty('--wallpaper-dim') }
  }, [appearance, user, setTheme, brandHue, resolvedTheme, minDim])

  const update = useCallback((patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch }
    setAppearance(next)
    try { localStorage.setItem(storageKey(user?.id), JSON.stringify(next)); return true } catch { return false } // false = storage full
  }, [appearance, user])

  const reset = useCallback(() => {
    setAppearance(DEFAULT)
    try { localStorage.removeItem(storageKey(user?.id)) } catch { /* ignore */ }
  }, [user])

  const value = useMemo(() => ({ appearance, minDim, update, reset }), [appearance, minDim, update, reset])
  return <AppearanceCtx.Provider value={value}>{children}</AppearanceCtx.Provider>
}

export function useAppearance() {
  const c = useContext(AppearanceCtx)
  if (!c) throw new Error('useAppearance outside AppearanceProvider')
  return c
}
