import { fitLightness, type Hsl } from './contrast.ts'

/** Builds the full colour palette (as HSL triplets) for a hue in light or dark mode. */
export function palette(h: number, mode: 'light' | 'dark'): Record<string, string> {
  const dark = mode === 'dark'
  // The accent and the outline of form controls are fitted for contrast, because the same lightness looks very different
  // at different hues (a yellow at 42% is far paler than a blue at 42%). Accent: 4.6:1 as text and behind button text.
  // Control outline: 3:1 against the page and cards (WCAG 1.4.11).
  const bgC: Hsl = dark ? [h, 30, 7] : [h, 40, 97]
  const cardC: Hsl = dark ? [h, 26, 10] : [0, 0, 100]
  const priL = dark ? fitLightness(h, 85, 66, 1, [bgC, cardC], 4.6) : fitLightness(h, 70, 42, -1, [bgC, cardC], 4.6)
  const inputL = dark ? fitLightness(h, 14, 38, 1, [bgC, cardC], 3.1) : fitLightness(h, 12, 62, -1, [bgC, cardC], 3.1)
  const p = dark
    ? { bg: `${h} 30% 7%`, card: `${h} 26% 10%`, fg: `${h} 20% 96%`, pri: `${h} 85% ${priL}%`, priFg: `${h} 40% 8%`, soft: `${h} 24% 16%`, mut: `${h} 14% 68%`, bd: `${h} 22% 20%`, input: `${h} 14% ${inputL}%` }
    : { bg: `${h} 40% 97%`, card: `0 0% 100%`, fg: `${h} 30% 10%`, pri: `${h} 70% ${priL}%`, priFg: `0 0% 100%`, soft: `${h} 35% 93%`, mut: `${h} 12% 38%`, bd: `${h} 25% 87%`, input: `${h} 12% ${inputL}%` }
  return {
    '--background': p.bg, '--foreground': p.fg,
    '--card': p.card, '--card-foreground': p.fg,
    '--popover': p.card, '--popover-foreground': p.fg,
    '--primary': p.pri, '--primary-foreground': p.priFg,
    '--secondary': p.soft, '--secondary-foreground': p.fg,
    '--muted': p.soft, '--muted-foreground': p.mut,
    '--accent': p.soft, '--accent-foreground': p.fg,
    '--border': p.bd, '--input': p.input, '--ring': p.pri,
    '--sidebar-background': p.card, '--sidebar-foreground': p.fg,
    '--sidebar-primary': p.pri, '--sidebar-primary-foreground': p.priFg,
    '--sidebar-accent': p.soft, '--sidebar-accent-foreground': p.fg, '--sidebar-border': p.bd,
  }
}
