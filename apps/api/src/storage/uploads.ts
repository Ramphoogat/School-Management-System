import { BadRequestException } from '@nestjs/common'
import { ALLOWED_FILES_TEXT, cleanName, judgeUpload, type Upload } from './upload-rules'

export { MAX_FILE_BYTES, type Upload } from './upload-rules'

/** Throws 400 unless the upload is an allowed type whose content matches; returns the server-decided mime and a safe name. */
export function checkUpload(file: Upload | undefined) {
  if (!file) throw new BadRequestException('Choose a file to upload (max 100 MB)')
  const type = judgeUpload(file)
  if (!type) throw new BadRequestException(`Allowed files: ${ALLOWED_FILES_TEXT}`)
  return { mime: type.mime, name: cleanName(file.originalname) }
}

/** Response headers for a download: always an attachment, with the type we decided, never sniffed. */
export const contentHeaders = (f: { mime: string; name: string }, length: number) => ({
  'Content-Type': f.mime,
  'Content-Length': String(length),
  'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
})
