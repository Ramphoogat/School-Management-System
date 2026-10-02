/**
 * Turns a link someone pasted (a Google Drive share link, a Dropbox link and so on) into the address the file can really be
 * downloaded from. Pure functions, no network: the download itself is link-fetch.ts.
 */
export class LinkError extends Error {}

export type LinkKind = 'gdrive' | 'gdoc' | 'dropbox' | 'onedrive' | 'github' | 'direct'

export interface ResolvedLink {
  kind: LinkKind
  /** Where to download from. */
  fetchUrl: string
  /** For Google Drive, Docs, Sheets and Slides links: the Drive file id (lets the app read a private file shared with it). */
  driveFileId?: string
  /** A file name to use when the site does not give one. */
  nameHint?: string
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/

export function resolveLink(raw: string): ResolvedLink {
  const text = (raw ?? '').trim()
  if (!text) throw new LinkError('Paste a link first')
  if (text.length > 2000) throw new LinkError('That link is too long')
  let u: URL
  try { u = new URL(text) } catch { throw new LinkError('That does not look like a web link. It should start with https://') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new LinkError('Only web links (starting with https://) can be used')
  if (u.username || u.password) throw new LinkError('Links that contain a username or password cannot be used')
  const host = u.hostname.toLowerCase().replace(/^www\./, '')

  // Google Drive file
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
    if (/^\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) throw new LinkError('That is a Drive folder. Open the file itself and copy its link')
    const id = u.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([^/]+)/)?.[1] ?? u.searchParams.get('id')
    if (!id || !DRIVE_ID.test(id)) throw new LinkError('Could not find a file in that Google Drive link')
    return { kind: 'gdrive', driveFileId: id, fetchUrl: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` }
  }

  // Google Docs, Sheets and Slides: saved as a PDF copy
  if (host === 'docs.google.com') {
    const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([^/]+)/)
    if (!m || !DRIVE_ID.test(m[2])) throw new LinkError('That Google link is not a Doc, Sheet or Slides file')
    const [, type, id] = m
    const fetchUrl = type === 'presentation' ? `https://docs.google.com/presentation/d/${id}/export/pdf` : `https://docs.google.com/${type}/d/${id}/export?format=pdf`
    return { kind: 'gdoc', driveFileId: id, fetchUrl, nameHint: 'document.pdf' }
  }

  // Dropbox share link: ?dl=1 makes it a download
  if (host === 'dropbox.com') {
    u.searchParams.set('dl', '1')
    return { kind: 'dropbox', fetchUrl: u.toString() }
  }

  // OneDrive: the sharing API turns any public share link into the file itself
  if (host === '1drv.ms' || host === 'onedrive.live.com') {
    return { kind: 'onedrive', fetchUrl: `https://api.onedrive.com/v1.0/shares/u!${Buffer.from(text).toString('base64url')}/root/content` }
  }
  if (host.endsWith('.sharepoint.com')) {
    u.searchParams.set('download', '1')
    return { kind: 'onedrive', fetchUrl: u.toString() }
  }

  // GitHub file page: the raw file
  if (host === 'github.com') {
    const g = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
    if (g) return { kind: 'github', fetchUrl: `https://raw.githubusercontent.com/${g[1]}/${g[2]}/${g[3]}` }
  }

  return { kind: 'direct', fetchUrl: u.toString() }
}

export interface LinkSourceInfo { id: LinkKind; name: string; example: string; how: string }

/** What the "?" button shows: where a link can come from and how to get a link that works. */
export const LINK_SOURCES: LinkSourceInfo[] = [
  {
    id: 'gdrive', name: 'Google Drive file', example: 'https://drive.google.com/file/d/…/view',
    how: 'Open the file in Google Drive and choose Share. Either set "Anyone with the link" to Viewer, or share the file with the school\'s Drive address shown below. Then copy the link.',
  },
  {
    id: 'gdoc', name: 'Google Docs, Sheets or Slides', example: 'https://docs.google.com/document/d/…/edit',
    how: 'Share it the same way as a Drive file. The school keeps a PDF copy of it.',
  },
  {
    id: 'dropbox', name: 'Dropbox', example: 'https://www.dropbox.com/s/…/notes.pdf',
    how: 'Choose Share, then create a link that anyone with the link can open, and copy it.',
  },
  {
    id: 'onedrive', name: 'OneDrive or SharePoint', example: 'https://1drv.ms/b/…',
    how: 'Choose Share and set it to "Anyone with the link can view", then copy the link.',
  },
  {
    id: 'github', name: 'GitHub file', example: 'https://github.com/owner/repo/blob/main/guide.pdf',
    how: 'Open the file on GitHub and copy the address of the page.',
  },
  {
    id: 'direct', name: 'Any direct file link', example: 'https://example.com/files/timetable.pdf',
    how: 'A link that goes straight to a file (it usually ends in .pdf, .docx, .jpg and so on) and opens without signing in.',
  },
]

export const LINKS_NOT_SUPPORTED = [
  'Links that ask you to sign in. The school cannot sign in for you; share the file publicly instead (for a Google Drive file you can share it with the school\'s Drive address).',
  'Web pages that are not a file, such as YouTube videos, news articles or whole folders.',
  'Files bigger than the size limit, or types other than PDF, Word (.doc, .docx), text (.txt), PNG and JPG.',
]
