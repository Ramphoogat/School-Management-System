/** WCAG contrast maths for the theme palettes. Pure functions, so the palette can be fitted and checked without a browser. */

export type Hsl = [number, number, number] // degrees, percent, percent

export type Rgb = [number, number, number] // each 0 to 1

export const toRgb = ([h, s, l]: Hsl): Rgb => {
  const sat = s / 100, light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const luminanceRgb = (c: Rgb) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const luminance = (c: Hsl) => luminanceRgb(toRgb(c))

/** WCAG contrast ratio between two colours, 1 (none) to 21 (black on white). */
export function contrast(a: Hsl, b: Hsl): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Moves a colour's lightness in `dir` (-1 darker, +1 lighter) from `from` in 1% steps until it reaches `min` contrast
 * against every colour in `against`. Hue and saturation are kept, so the theme keeps its character.
 */
export function fitLightness(h: number, s: number, from: number, dir: 1 | -1, against: Hsl[], min: number): number {
  let l = from
  while (l > 0 && l < 100 && against.some((bg) => contrast([h, s, l], bg) < min)) l += dir
  return l
}

/** Contrast between two RGB colours. */
export function contrastRgb(a: Rgb, b: Rgb): number {
  const [x, y] = [luminanceRgb(a), luminanceRgb(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** What a wallpaper pixel looks like once the page colour is laid over it at `dim` (0 to 1), as the wallpaper layer does. */
export const laidOver = (pixel: Rgb, page: Rgb, dim: number): Rgb => [0, 1, 2].map((i) => pixel[i] * (1 - dim) + page[i] * dim) as Rgb

/**
 * The least dimming (0 to `max`, in 1% steps; by default up to 100%, where the wallpaper is fully covered) at which every text colour reaches `target` contrast on every given wallpaper
 * colour. Pass the wallpaper's lightest and darkest colours and this holds for everything in between. If even `max` is not
 * enough (a very bright picture with light text), `max` is returned: the best that can be done.
 */
export function minDim(text: Hsl[], page: Hsl, pixels: Rgb[], target = 4.5, max = 1): number {
  const pageRgb = toRgb(page)
  for (let d = 0; d <= max + 1e-9; d += 0.01) {
    if (pixels.every((px) => text.every((t) => contrastRgb(toRgb(t), laidOver(px, pageRgb, d)) >= target))) return Math.round(d * 100) / 100
  }
  return max
}
