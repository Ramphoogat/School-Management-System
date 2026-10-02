import { BadRequestException, Controller, ForbiddenException, Get, Global, Injectable, Module, UseGuards } from '@nestjs/common'
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/guards'
import { ALLOWED_FILES_TEXT, FILE_TYPES, judgeUpload, MAX_FILE_BYTES, type Upload } from '../storage/upload-rules'
import { driveFor } from '../storage/storage'
import { driveExportPdf, driveGet, driveMeta, driveShareEmail, type DriveConfig } from '../storage/drive'
import { LINKS_NOT_SUPPORTED, LINK_SOURCES, LinkError, resolveLink, type ResolvedLink } from './link-sources'
import { downloadUrl, type Downloaded } from './link-fetch'

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
}
const WEB_PAGE = new Set(['text/html', 'application/xhtml+xml'])
const mb = () => Math.round(MAX_FILE_BYTES / 1_048_576)

/** A file read through Google Drive's own sign-in: for a private file that was shared with the school's Drive address. */
async function viaDrive(cfg: DriveConfig, id: string): Promise<Downloaded> {
  const meta = await driveMeta(cfg, id)
  if (meta.size !== null && meta.size > MAX_FILE_BYTES) throw new LinkError(`The file is bigger than ${mb()} MB`)
  if (meta.mimeType.startsWith('application/vnd.google-apps.')) {
    const buffer = await driveExportPdf(cfg, id)
    if (buffer.length > MAX_FILE_BYTES) throw new LinkError(`The file is bigger than ${mb()} MB`)
    return { buffer, contentType: 'application/pdf', filename: /\.pdf$/i.test(meta.name) ? meta.name : `${meta.name}.pdf` }
  }
  return { buffer: await driveGet(cfg, id), contentType: meta.mimeType.toLowerCase(), filename: meta.name }
}

/** The name the file will have: the one the site gave, else the end of the address, else a hint; with an allowed extension. */
function pickName(got: Downloaded, link: ResolvedLink): string {
  let name = got.filename
  if (!name && link.kind !== 'gdrive' && link.kind !== 'gdoc' && link.kind !== 'onedrive') {
    try { name = decodeURIComponent(new URL(got.finalUrl ?? link.fetchUrl).pathname.split('/').filter(Boolean).pop() ?? '') } catch { name = '' }
  }
  name = (name || link.nameHint || 'file').trim()
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (!FILE_TYPES[ext]) {
    const add = EXT_BY_TYPE[got.contentType]
    if (!add) throw new BadRequestException(`Could not tell what kind of file that link is. Allowed: ${ALLOWED_FILES_TEXT}`)
    name = `${name.replace(/\.+$/, '')}.${add}`
  }
  return name
}

/**
 * Fetches a file from a pasted link so it can be added like an uploaded one. People who may upload files may use it, except
 * students. A Google Drive link that cannot be opened publicly is read with the school's own Drive sign-in if the file was
 * shared with it.
 */
@Injectable()
export class ImportService {
  async fromLink(user: AuthUser, rawUrl: string): Promise<Upload> {
    if (user.role === 'student') throw new ForbiddenException('Students cannot add files from a link')
    let link: ResolvedLink
    try { link = resolveLink(rawUrl) } catch (e) { throw new BadRequestException((e as Error).message) }

    let got: Downloaded | null = null
    let problem = ''
    try {
      const d = await downloadUrl(link.fetchUrl, { maxBytes: MAX_FILE_BYTES })
      if (WEB_PAGE.has(d.contentType)) problem = 'That link opens a web page, not a file'
      else got = d
    } catch (e) {
      problem = e instanceof LinkError ? e.message : 'Could not download from that link'
    }

    const cfg = await driveFor(user.schoolId)
    if (!got && link.driveFileId && cfg) {
      try { got = await viaDrive(cfg, link.driveFileId) } catch (e) { if (!problem) problem = (e as Error).message }
    }
    if (!got) {
      const hint = link.driveFileId
        ? cfg ? ` If the file is private, share it with ${driveShareEmail(cfg) ?? 'the school\'s Google Drive account'} and try again.` : ' If the file is private, set it to "Anyone with the link can view" and try again.'
        : ''
      throw new BadRequestException(`${problem}.${hint}`)
    }

    const name = pickName(got, link)
    // File names arrive from uploads as latin1 text that cleanName() turns back into UTF-8; do the same here so names with accents survive.
    const upload: Upload = { originalname: Buffer.from(name, 'utf8').toString('latin1'), buffer: got.buffer, size: got.buffer.length }
    if (!judgeUpload(upload)) throw new BadRequestException(`That link is not an allowed file. Allowed: ${ALLOWED_FILES_TEXT}`)
    return upload
  }
}

/** What the "?" button shows: where links can come from, and how. */
@Controller('import')
@UseGuards(AuthGuard)
export class ImportController {
  @Get('sources')
  async sources(@CurrentUser() user: AuthUser) {
    const cfg = await driveFor(user.schoolId)
    return {
      canUseLinks: user.role !== 'student',
      maxMb: mb(),
      allowed: ALLOWED_FILES_TEXT,
      driveConnected: !!cfg,
      shareWith: driveShareEmail(cfg),
      sources: LINK_SOURCES,
      notSupported: LINKS_NOT_SUPPORTED,
    }
  }
}

@Global()
@Module({ providers: [ImportService], controllers: [ImportController], exports: [ImportService] })
export class ImportModule {}
