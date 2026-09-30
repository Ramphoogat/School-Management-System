import { useEffect, useState } from 'react'
import { apiUrl } from './api'

/** What a school looks like: its name, tagline, accent colour (a hue, 0 to 360) and logo. */
export interface Brand { slug: string | null; name: string; tagline: string | null; brandHue: number | null; logo: string | null }

const KEY = 'tenant.slug'

/**
 * Which school this address belongs to. In order: a ?school= link (remembered for next time), the subdomain
 * (greenfield.example.com when VITE_BASE_DOMAIN is example.com, or greenfield.localhost while developing), then the
 * school last used on this device. Null means the general sign-in page.
 */
export function resolveSlug(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('school')?.trim().toLowerCase()
    if (q) { localStorage.setItem(KEY, q); return q }
  } catch { /* storage can be blocked */ }
  const host = window.location.hostname.toLowerCase()
  const base = (import.meta.env.VITE_BASE_DOMAIN as string | undefined)?.toLowerCase()
  if (base && host.endsWith(`.${base}`)) {
    const s = host.slice(0, -(base.length + 1)).split('.')[0]
    if (s && s !== 'www') return s
  }
  if (host.endsWith('.localhost')) {
    const s = host.slice(0, -'.localhost'.length).split('.')[0]
    if (s) return s
  }
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function forgetSlug() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** The full web address a school's people use to sign in. */
export function signInAddress(slug: string): string {
  const base = import.meta.env.VITE_BASE_DOMAIN as string | undefined
  if (base) return `${window.location.protocol}//${slug}.${base}`
  return `${window.location.origin}/?school=${slug}`
}

export const logoSrc = (b: { logo: string | null } | null | undefined) => (b?.logo ? apiUrl(b.logo) : null)

type TenantState = { slug: string | null; brand: Brand | null; state: 'none' | 'loading' | 'ready' | 'missing' }
const cache = new Map<string, Brand | 'missing'>()

/** The school the page is for, loaded once. 'missing' means the address is unknown or the school is suspended. */
export function useTenant(): TenantState {
  const slug = resolveSlug()
  const [, tick] = useState(0)

  useEffect(() => {
    if (!slug || cache.has(slug)) return
    let live = true
    fetch(apiUrl(`/api/tenant/${encodeURIComponent(slug)}`))
      .then(async (r) => { cache.set(slug, r.ok ? ((await r.json()) as Brand) : 'missing') })
      .catch(() => cache.set(slug, 'missing'))
      .finally(() => { if (live) tick((n) => n + 1) })
    return () => { live = false }
  }, [slug])

  if (!slug) return { slug: null, brand: null, state: 'none' }
  const hit = cache.get(slug)
  if (!hit) return { slug, brand: null, state: 'loading' }
  return hit === 'missing' ? { slug, brand: null, state: 'missing' } : { slug, brand: hit, state: 'ready' }
}
