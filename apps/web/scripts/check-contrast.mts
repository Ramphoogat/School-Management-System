// Checks the generated theme palettes (all 360 hues, light and dark) and the wallpaper dimming rule against WCAG contrast targets.
// Run with: pnpm --filter @school/web check:contrast   (needs Node 22.18+ or 23.6+, which runs .ts files directly)
import { contrast, contrastRgb, laidOver, minDim, toRgb, type Hsl, type Rgb } from '../src/lib/contrast.ts'
import { palette } from '../src/lib/palette.ts'

const parse = (v: string): Hsl => { const [h, s, l] = v.replace(/%/g, '').split(' ').map(Number); return [h, s, l] }
const CHECKS: [string, string, string, number][] = [
  ['text on page', '--foreground', '--background', 4.5],
  ['text on card', '--card-foreground', '--card', 4.5],
  ['muted text on page', '--muted-foreground', '--background', 4.5],
  ['muted text on card', '--muted-foreground', '--card', 4.5],
  ['muted text on soft fill', '--muted-foreground', '--muted', 4.5],
  ['button text on primary', '--primary-foreground', '--primary', 4.5],
  ['primary colour as text on page', '--primary', '--background', 4.5],
  ['primary colour as text on card', '--primary', '--card', 4.5],
  ['form control outline on page', '--input', '--background', 3],
  ['form control outline on card', '--input', '--card', 3],
]

let failures = 0
for (const mode of ['light', 'dark'] as const) {
  for (let h = 0; h < 360; h++) {
    const p = palette(h, mode)
    for (const [name, fg, bg, min] of CHECKS) {
      const r = contrast(parse(p[fg]), parse(p[bg]))
      if (r < min) { failures++; console.log(`FAIL ${mode} hue ${h}: ${name} is ${r.toFixed(2)}:1, needs ${min}:1`) }
    }
  }
}
console.log(failures ? `${failures} palette failure(s)` : 'All 720 palettes meet their contrast targets.')

// Wallpapers: whatever the picture, the dimming the app enforces must leave text readable (4.5:1) on it.
const PICTURES: [string, Rgb][] = [['white', [1, 1, 1]], ['black', [0, 0, 0]], ['mid grey', [0.5, 0.5, 0.5]], ['red', [1, 0, 0]], ['green', [0, 1, 0]], ['blue', [0, 0, 1]], ['yellow', [1, 1, 0]]]
let wallpaperFailures = 0
for (const mode of ['light', 'dark'] as const) {
  for (let h = 0; h < 360; h += 5) {
    const p = palette(h, mode)
    const text = [parse(p['--foreground']), parse(p['--muted-foreground'])]
    const page = parse(p['--background'])
    for (const [name, px] of PICTURES) {
      const d = minDim(text, page, [px])
      const worst = Math.min(...text.map((t) => contrastRgb(toRgb(t), laidOver(px, toRgb(page), d))))
      if (worst < 4.5) { wallpaperFailures++; console.log(`FAIL wallpaper ${name}, ${mode} hue ${h}: text is ${worst.toFixed(2)}:1 even at ${Math.round(d * 100)}% dimming`) }
    }
  }
}
console.log(wallpaperFailures ? `${wallpaperFailures} wallpaper failure(s)` : 'Enforced wallpaper dimming keeps text readable on every test picture, in every palette.')

process.exit(failures + wallpaperFailures ? 1 : 0)
