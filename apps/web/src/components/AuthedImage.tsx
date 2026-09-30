import { useEffect, useState, type ReactNode } from 'react'
import { fetchBlob } from '@/lib/api'

// One download per picture and version, shared by every place that shows it.
const urls = new Map<string, Promise<string | null>>()
const load = (path: string) => {
  if (!urls.has(path)) urls.set(path, fetchBlob(path).then((b) => URL.createObjectURL(b)).catch(() => null))
  return urls.get(path)!
}

/**
 * A picture that needs the sign-in to load, such as a student's ID photo. A plain <img> cannot send the login, so the
 * picture is fetched with it and shown from memory. `fallback` shows while loading and when there is no picture.
 * Put a version in the path (?v=) so a replaced picture is fetched again.
 */
export function AuthedImage({ path, alt, className, fallback }: { path: string | null; alt: string; className?: string; fallback?: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!path) return
    let live = true
    void load(path).then((u) => { if (live) setSrc(u) })
    return () => { live = false }
  }, [path])
  return src ? <img src={src} alt={alt} className={className} /> : <>{fallback ?? null}</>
}
