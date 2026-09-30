import type { Response } from 'express'

/** A file name that is safe everywhere: plain ASCII for old clients, and the full UTF-8 name for the rest. */
export function sendPdf(res: Response, pdf: Buffer, niceName: string) {
  const ascii = niceName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(niceName)}.pdf`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  })
  res.end(pdf)
}

export const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
