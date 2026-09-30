import PDFDocument from 'pdfkit'
import { dirname, join } from 'node:path'

/**
 * PDF documents for certificates and report cards.
 *
 * Text is drawn by hand, one run at a time, because PDFKit overprints itself when a centred or wrapped paragraph switches
 * fonts (say, an English sentence around a name written in Devanagari). Each string is split into runs by which bundled
 * font can draw it (Latin, Latin Extended or Devanagari), measured, wrapped and placed run by run. A character none of the
 * fonts has becomes "?", so nothing ever prints as an empty box.
 */

const filesOf = (pkg: string) => join(dirname(require.resolve(`${pkg}/package.json`)), 'files')
const noto = filesOf('@fontsource/noto-sans')
const dev = filesOf('@fontsource/noto-sans-devanagari')

type Weight = 400 | 700
const SCRIPTS = ['latin', 'ext', 'dev'] as const
type Script = (typeof SCRIPTS)[number]
const FILE: Record<Script, (w: Weight) => string> = {
  latin: (w) => join(noto, `noto-sans-latin-${w}-normal.woff`),
  ext: (w) => join(noto, `noto-sans-latin-ext-${w}-normal.woff`),
  dev: (w) => join(dev, `noto-sans-devanagari-devanagari-${w}-normal.woff`),
}
const face = (s: Script, w: Weight) => `${s}-${w}`

interface Glyphs { hasGlyphForCodePoint(cp: number): boolean }

/** Draws text in the bundled fonts on one PDFKit document. */
export class Pen {
  private cache = new Map<string, Script | null>()
  constructor(private doc: PDFKit.PDFDocument) {
    for (const s of SCRIPTS) for (const w of [400, 700] as Weight[]) doc.registerFont(face(s, w), FILE[s](w))
  }

  private glyphs(s: Script, w: Weight): Glyphs {
    // PDFKit keeps the parsed font on the document; that is the only place to ask which characters it can draw.
    return (this.doc.font(face(s, w)) as unknown as { _font: { font: Glyphs } })._font.font
  }

  private scriptFor(ch: string, w: Weight): Script | null {
    if (/\s/.test(ch)) return 'latin'
    const key = `${w}:${ch}`
    if (this.cache.has(key)) return this.cache.get(key)!
    const cp = ch.codePointAt(0)!
    const found = SCRIPTS.find((s) => this.glyphs(s, w).hasGlyphForCodePoint(cp)) ?? null
    this.cache.set(key, found)
    return found
  }

  /** Split into runs that one font can draw. Joiners stay with the character before them. */
  runs(text: string, w: Weight): { script: Script; text: string }[] {
    const out: { script: Script; text: string }[] = []
    for (const ch of text.replace(/[\u0000-\u0008\u000b-\u001f]/g, '')) {
      const joiner = ch === '‌' || ch === '‍'
      const script = joiner && out.length ? out[out.length - 1].script : this.scriptFor(ch, w)
      const drawable = script ?? 'latin'
      const glyph = script ? ch : '?'
      if (out.length && out[out.length - 1].script === drawable) out[out.length - 1].text += glyph
      else out.push({ script: drawable, text: glyph })
    }
    return out
  }

  width(text: string, size: number, w: Weight = 400): number {
    return this.runs(text, w).reduce((sum, r) => sum + this.doc.font(face(r.script, w)).fontSize(size).widthOfString(r.text), 0)
  }

  /** One line, placed left, centre or right inside the box that starts at x and is `box` wide. */
  line(text: string, x: number, y: number, o: { size?: number; weight?: Weight; align?: 'left' | 'center' | 'right'; box?: number; color?: string } = {}) {
    const size = o.size ?? 11, weight = o.weight ?? 400
    const total = this.width(text, size, weight)
    let cx = x
    if (o.box !== undefined && o.align === 'center') cx = x + (o.box - total) / 2
    if (o.box !== undefined && o.align === 'right') cx = x + o.box - total
    this.doc.fillColor(o.color ?? '#111111')
    for (const r of this.runs(text, weight)) {
      // Devanagari has taller ascenders, so its runs are nudged down to share a baseline with the Latin text around them.
      const drop = r.script === 'dev' ? size * 0.13 : 0
      this.doc.font(face(r.script, weight)).fontSize(size).text(r.text, cx, y + drop, { lineBreak: false })
      cx += this.doc.widthOfString(r.text)
    }
  }

  /** Greedy word wrap. */
  wrap(text: string, size: number, maxWidth: number, weight: Weight = 400): string[] {
    const lines: string[] = []
    for (const para of text.split('\n')) {
      let cur = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word
        if (cur && this.width(next, size, weight) > maxWidth) { lines.push(cur); cur = word } else cur = next
      }
      lines.push(cur)
    }
    return lines
  }

  /** A wrapped paragraph. Returns the y just below it. */
  paragraph(text: string, x: number, y: number, width: number, o: { size?: number; weight?: Weight; align?: 'left' | 'center'; lineHeight?: number; color?: string } = {}): number {
    const size = o.size ?? 11
    const step = o.lineHeight ?? size * 1.55
    for (const l of this.wrap(text, size, width, o.weight ?? 400)) {
      this.line(l, x, y, { size, weight: o.weight, align: o.align, box: width, color: o.color })
      y += step
    }
    return y
  }
}

const collect = (doc: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })

export interface CertificatePdf {
  schoolName: string
  title: string // "Bonafide certificate"
  text: string // the sentence certifying the student
  number: string
  issuedOn: string // already formatted
  signatory?: string
  brandHue?: number | null
}

/** A4 landscape certificate with a double border, the school name, the wording, the number and a signature line. */
export async function renderCertificatePdf(c: CertificatePdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `${c.title} ${c.number}`, Author: c.schoolName } })
  const pen = new Pen(doc)
  const W = doc.page.width, H = doc.page.height
  const accent = c.brandHue == null ? '#1f3a5f' : hslToHex(c.brandHue, 55, 32)

  doc.lineWidth(3).strokeColor(accent).rect(28, 28, W - 56, H - 56).stroke()
  doc.lineWidth(0.8).strokeColor(accent).rect(38, 38, W - 76, H - 76).stroke()

  pen.line(c.schoolName, 60, 96, { size: 30, weight: 700, align: 'center', box: W - 120, color: accent })
  pen.line(c.title.toUpperCase(), 60, 150, { size: 16, weight: 700, align: 'center', box: W - 120 })
  doc.lineWidth(1).strokeColor(accent).moveTo(W / 2 - 60, 182).lineTo(W / 2 + 60, 182).stroke()

  pen.paragraph(c.text, 110, 218, W - 220, { size: 17, align: 'center', lineHeight: 30 })

  const base = H - 118
  pen.line(`No. ${c.number}`, 80, base, { size: 11 })
  pen.line(`Date: ${c.issuedOn}`, 80, base + 18, { size: 11 })
  doc.lineWidth(0.8).strokeColor('#111111').moveTo(W - 260, base + 14).lineTo(W - 80, base + 14).stroke()
  pen.line(c.signatory ?? 'Principal', W - 260, base + 20, { size: 11, align: 'center', box: 180 })
  return collect(doc)
}

export interface ReportCardPdf {
  schoolName: string
  studentName: string
  className: string
  termLabel: string | null
  results: { subject: string; exam: string; date: string; score: number | null; maxMarks: number; absent: boolean; percent: number | null; grade: string | null }[]
  totalScore: number
  totalMax: number
  overallPercent: number | null
  overallGrade: string | null
  generatedOn: string
  brandHue?: number | null
}

/** A4 portrait report card: a header, a results table that flows onto more pages if needed, and the overall result. */
export async function renderReportCardPdf(r: ReportCardPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Report card, ${r.studentName}`, Author: r.schoolName } })
  const pen = new Pen(doc)
  const W = doc.page.width, H = doc.page.height, M = 48
  const accent = r.brandHue == null ? '#1f3a5f' : hslToHex(r.brandHue, 55, 32)
  const cols = [
    { label: 'Subject', x: M, w: 130 }, { label: 'Exam', x: M + 130, w: 140 }, { label: 'Date', x: M + 270, w: 72 },
    { label: 'Score', x: M + 342, w: 66 }, { label: '%', x: M + 408, w: 44 }, { label: 'Grade', x: M + 452, w: 50 },
  ]

  const header = () => {
    doc.rect(0, 0, W, 8).fill(accent)
    pen.line(r.schoolName, M, 38, { size: 22, weight: 700, color: accent })
    pen.line('Report card', M, 68, { size: 13, weight: 700 })
    pen.line(r.studentName, M, 96, { size: 16, weight: 700 })
    pen.line([r.className, r.termLabel].filter(Boolean).join('  ·  ') || ' ', M, 118, { size: 11, color: '#444444' })
    return 150
  }
  const tableHead = (y: number) => {
    doc.rect(M, y - 4, W - 2 * M, 22).fill('#eef1f5')
    for (const c of cols) pen.line(c.label, c.x + 6, y + 2, { size: 10, weight: 700 })
    return y + 26
  }

  let y = tableHead(header())
  if (r.results.length === 0) pen.line('No published results yet.', M + 6, y + 6, { size: 11, color: '#555555' })
  r.results.forEach((row, i) => {
    if (y > H - 130) { doc.addPage(); y = tableHead(header()) }
    if (i % 2 === 1) doc.rect(M, y - 5, W - 2 * M, 22).fill('#f8f9fb')
    const cell = (idx: number, text: string, weight: Weight = 400) => {
      const c = cols[idx]
      let t = text
      while (t.length > 1 && pen.width(t, 10, weight) > c.w - 10) t = t.slice(0, -1)
      pen.line(t === text ? t : `${t}…`, c.x + 6, y, { size: 10, weight })
    }
    cell(0, row.subject, 700); cell(1, row.exam); cell(2, row.date)
    cell(3, row.absent ? 'Absent' : `${row.score} / ${row.maxMarks}`); cell(4, row.percent === null ? '-' : String(row.percent)); cell(5, row.grade ?? '-')
    y += 22
  })

  if (y > H - 110) { doc.addPage(); y = header() }
  y += 14
  doc.rect(M, y, W - 2 * M, 44).lineWidth(1).stroke(accent)
  pen.line(`Overall: ${r.totalScore} / ${r.totalMax}`, M + 14, y + 15, { size: 12, weight: 700 })
  if (r.overallPercent !== null) pen.line(`${r.overallPercent}%   Grade ${r.overallGrade ?? '-'}`, M, y + 15, { size: 12, weight: 700, align: 'right', box: W - 2 * M - 14, color: accent })

  pen.line(`Generated on ${r.generatedOn}`, M, H - 46, { size: 9, color: '#777777' })
  return collect(doc)
}

/** PDFKit takes hex colours; the school's accent is a hue, so turn it into one. */
export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100, L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}
