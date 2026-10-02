import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { LinkError } from './link-sources'

/**
 * Downloads a file from a web link, safely. The app fetches addresses that people type in, so a link must never be able to reach
 * the school's own machines or network (this is "server-side request forgery"). Every connection, including every redirect, is
 * checked: addresses on this machine, the local network, link-local space (cloud metadata) and similar are refused, and the check
 * is made on the address actually connected to, so a name that changes its answer cannot trick it.
 */
let allowPrivate = false
/** Lets tests download from a server on this machine. Never used by the app itself. */
export const allowPrivateNetworksForTests = (on = true) => { allowPrivate = on }

function blockedV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

function blockedV6(ip: string): boolean {
  const s = ip.toLowerCase()
  if (s === '::' || s === '::1') return true
  const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return blockedV4(dotted[1])
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16)
    return blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff')
}

/** True for an address that must never be fetched. Anything that is not an IP address counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  if (allowPrivate) return false
  const v = net.isIP(ip)
  if (v === 4) return blockedV4(ip)
  if (v === 6) return blockedV6(ip)
  return true
}

const PRIVATE_MESSAGE = 'That link points to a private or internal address, which is not allowed'

/** DNS lookup that keeps only public addresses, so the connection can only go to one of those. */
function guardedLookup(hostname: string, options: { all?: boolean } | undefined, callback: (...args: any[]) => void) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err)
    const ok = (addresses as dns.LookupAddress[]).filter((a) => !isBlockedAddress(a.address))
    if (ok.length === 0) return callback(new LinkError(PRIVATE_MESSAGE))
    if (options?.all) return callback(null, ok)
    callback(null, ok[0].address, ok[0].family)
  })
}

export interface Downloaded {
  buffer: Buffer
  /** The type the site says it is, lower case, without parameters. */
  contentType: string
  /** The file name the site suggests, if it does. */
  filename: string | null
  /** The address the file really came from, after any redirects. */
  finalUrl?: string
}

/** The file name in a Content-Disposition header, if there is one. */
export function filenameFrom(header: string | string[] | undefined): string | null {
  const v = Array.isArray(header) ? header[0] : header
  if (!v) return null
  const star = v.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/)
  if (star) { try { return decodeURIComponent(star[1].trim()) } catch { /* fall through to the plain name */ } }
  const plain = v.match(/filename\s*=\s*"([^"]+)"/) ?? v.match(/filename\s*=\s*([^;]+)/)
  return plain ? plain[1].trim() : null
}

const friendly = (e: NodeJS.ErrnoException): string => {
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'Could not find that website'
  if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') return 'Could not connect to that website'
  if (e.code === 'CERT_HAS_EXPIRED' || /certificate|SSL|TLS/i.test(e.message)) return 'That website\'s security certificate is not valid'
  return 'Could not download from that link'
}

type Step = { kind: 'redirect'; to: URL } | { kind: 'done'; result: Downloaded }

function once(url: URL, maxBytes: number, timeoutMs: number): Promise<Step> {
  return new Promise<Step>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && isBlockedAddress(host)) return reject(new LinkError(PRIVATE_MESSAGE))
    const tooBig = new LinkError(`The file is bigger than ${Math.round(maxBytes / 1_048_576)} MB`)
    let settled = false
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(overall); fn() } }

    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, {
      method: 'GET',
      lookup: guardedLookup as unknown as net.LookupFunction,
      timeout: timeoutMs,
      headers: { 'user-agent': 'SchoolPlatform-LinkFetcher/1.0', accept: '*/*', 'accept-encoding': 'identity' },
    }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        try {
          const next = new URL(res.headers.location, url)
          if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('scheme')
          return done(() => resolve({ kind: 'redirect', to: next }))
        } catch {
          return done(() => reject(new LinkError('The link sends you somewhere that cannot be used')))
        }
      }
      if (status === 401 || status === 403) { res.resume(); return done(() => reject(new LinkError('The site wants a sign-in or permission to open this link'))) }
      if (status === 404 || status === 410) { res.resume(); return done(() => reject(new LinkError('The site says there is no file at that link'))) }
      if (status < 200 || status >= 300) { res.resume(); return done(() => reject(new LinkError(`The site answered with an error (${status})`))) }
      const length = Number(res.headers['content-length'])
      if (Number.isFinite(length) && length > maxBytes) { res.destroy(); return done(() => reject(tooBig)) }
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (c: Buffer) => {
        total += c.length
        if (total > maxBytes) { res.destroy(); return done(() => reject(tooBig)) }
        chunks.push(c)
      })
      res.on('end', () => done(() => resolve({
        kind: 'done',
        result: { buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), filename: filenameFrom(res.headers['content-disposition']), finalUrl: url.toString() },
      })))
      res.on('error', (e) => done(() => reject(new LinkError(friendly(e as NodeJS.ErrnoException)))))
    })
    const overall = setTimeout(() => req.destroy(new LinkError('The site took too long to send the file')), Math.max(timeoutMs * 2, 120_000))
    req.on('timeout', () => req.destroy(new LinkError('The site took too long to answer')))
    req.on('error', (e) => done(() => reject(e instanceof LinkError ? e : new LinkError(friendly(e as NodeJS.ErrnoException)))))
    req.end()
  })
}

/** Downloads the file at a web address, following up to five redirects, refusing anything bigger than maxBytes. */
export async function downloadUrl(rawUrl: string, opts: { maxBytes: number; timeoutMs?: number; maxRedirects?: number }): Promise<Downloaded> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  let url = new URL(rawUrl)
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const step = await once(url, opts.maxBytes, timeoutMs)
    if (step.kind === 'redirect') { url = step.to; continue }
    return step.result
  }
  throw new LinkError('The link redirects too many times')
}
