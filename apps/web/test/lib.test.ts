import { describe, expect, it } from 'vitest'
import { splitPhone } from '../src/lib/phone'
import { toCsv } from '../src/lib/csv'
import { contrast } from '../src/lib/contrast'
import { palette } from '../src/lib/palette'

describe('splitPhone', () => {
  it('splits the country code from the number', () => {
    expect(splitPhone('+91 98765 43210')).toEqual({ code: '+91', number: '9876543210' })
  })
  it('reads the longest matching code, so +971 is not +9', () => {
    expect(splitPhone('+971501234567')).toEqual({ code: '+971', number: '501234567' })
  })
  it('keeps an empty code when there is no plus, and copes with blanks', () => {
    expect(splitPhone('98765 43210')).toEqual({ code: '', number: '9876543210' })
    expect(splitPhone(null)).toEqual({ code: '', number: '' })
    expect(splitPhone('  ')).toEqual({ code: '', number: '' })
  })
})

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['l1\nl2', 'ok']])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"l1\nl2",ok')
  })
  it('defuses spreadsheet formulas but leaves plain numbers alone', () => {
    const out = toCsv(['v'], [['=SUM(A1)'], ['+1+1'], ['@cmd'], ['-5'], ['-2.5'], [null], [0]])
    expect(out.split('\r\n')).toEqual(['v', "'=SUM(A1)", "'+1+1", "'@cmd", '-5', '-2.5', '', '0'])
  })
})

describe('contrast', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrast([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 0)
    expect(contrast([200, 50, 40], [200, 50, 40])).toBeCloseTo(1, 5)
  })
})

describe('palette', () => {
  it('gives readable body text at every hue, light and dark', () => {
    const parse = (v: string): [number, number, number] => { const [h, s, l] = v.replace(/%/g, '').split(' ').map(Number); return [h, s, l] }
    for (const mode of ['light', 'dark'] as const) {
      for (let h = 0; h < 360; h += 15) {
        const p = palette(h, mode)
        expect(contrast(parse(p['--foreground']), parse(p['--background']))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
