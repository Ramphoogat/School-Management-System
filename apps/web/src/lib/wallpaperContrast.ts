import type { Rgb } from './contrast.ts'

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The colours of a built-in gradient: its stops. */
export function gradientColours(css: string): Rgb[] {
  return (css.match(/#[0-9a-fA-F]{6}/g) ?? []).map(hex)
}

/** The lightest and darkest typical colours of a picture (5th and 95th percentile by brightness, so one stray pixel does not decide). */
export function imageExtremes(data: Uint8ClampedArray): Rgb[] {
  const px: Rgb[] = []
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 8) px.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255])
  if (!px.length) return []
  px.sort((a, b) => lum(a) - lum(b))
  return [px[Math.floor(px.length * 0.05)], px[Math.min(px.length - 1, Math.floor(px.length * 0.95))]]
}

/** Samples an uploaded picture on a small canvas. */
export function pictureColours(dataUrl: string): Promise<Rgb[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 48
      const ctx = c.getContext('2d')
      if (!ctx) return resolve([])
      ctx.drawImage(img, 0, 0, 48, 48)
      try { resolve(imageExtremes(ctx.getImageData(0, 0, 48, 48).data)) } catch { resolve([]) }
    }
    img.onerror = () => resolve([])
    img.src = dataUrl
  })
}
