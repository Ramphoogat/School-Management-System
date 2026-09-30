/** The colours a school's accent hue turns into, for light and dark mode. Same recipe as the personal colour themes. */
export const BRAND_VARS = ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground']

export function brandVars(hue: number, dark: boolean): Record<string, string> {
  const primary = dark ? `${hue} 85% 66%` : `${hue} 70% 42%`
  const on = dark ? `${hue} 40% 8%` : '0 0% 100%'
  return { '--primary': primary, '--primary-foreground': on, '--ring': primary, '--sidebar-primary': primary, '--sidebar-primary-foreground': on }
}

/** A swatch colour for previews (a solid version of the accent). */
export const brandSwatch = (hue: number, dark = false) => `hsl(${brandVars(hue, dark)['--primary']})`
