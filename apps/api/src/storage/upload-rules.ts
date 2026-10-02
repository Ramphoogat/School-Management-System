/**
 * What may be uploaded, and how a file is judged. The type is decided from the extension and the file's own first bytes,
 * never from what the browser claims, so a renamed program cannot pass as a picture.
 */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

export const FILE_TYPES: Record<string, { mime: string; ok: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', ok: (b) => b.subarray(0, 4).toString() === '%PDF' },
  png: { mime: 'image/png', ok: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  jpg: { mime: 'image/jpeg', ok: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  jpeg: { mime: 'image/jpeg', ok: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ok: (b) => b.subarray(0, 2).toString() === 'PK' },
  doc: { mime: 'application/msword', ok: (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
  txt: { mime: 'text/plain; charset=utf-8', ok: (b) => !b.includes(0) },
}

export const ALLOWED_FILES_TEXT = 'PDF, PNG, JPG, DOC, DOCX, TXT'

export interface Upload { originalname: string; buffer: Buffer; size: number }

/** The uploaded file's type if it is allowed and really is what its extension says, otherwise null. */
export function judgeUpload(file: Upload): { mime: string } | null {
  const ext = file.originalname.split('.').pop()?.toLowerCase() ?? ''
  const type = FILE_TYPES[ext]
  return type && type.ok(file.buffer) ? { mime: type.mime } : null
}

/** A safe display name: multer decodes names as latin1, and path or control characters are replaced. */
export const cleanName = (n: string) => Buffer.from(n, 'latin1').toString('utf8').replace(/[\\/\x00-\x1f"]/g, '_').slice(0, 120) || 'file'
