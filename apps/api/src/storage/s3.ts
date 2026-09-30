import { createHash, createHmac } from 'node:crypto'

/**
 * A small S3-compatible object store client (Amazon S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2 ...).
 * It signs requests with AWS Signature Version 4 itself, so no SDK is needed. Turned on by setting S3_BUCKET.
 *
 *   S3_BUCKET             bucket name (required to turn this on)
 *   S3_ACCESS_KEY_ID      / S3_SECRET_ACCESS_KEY
 *   S3_REGION             default "auto" (Cloudflare R2); use e.g. "ap-south-1" for Amazon S3
 *   S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com. Leave empty for Amazon S3.
 *   S3_FORCE_PATH_STYLE   "true"/"false". Default: true when an endpoint is set, false for Amazon S3.
 *   S3_PREFIX             optional folder inside the bucket
 */
export interface S3Config { bucket: string; accessKeyId: string; secretAccessKey: string; region: string; endpoint?: string; pathStyle: boolean; prefix: string }

export function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET
  if (!bucket) return null
  const endpoint = process.env.S3_ENDPOINT?.replace(/\/+$/, '') || undefined
  const forced = process.env.S3_FORCE_PATH_STYLE
  return {
    bucket,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    region: process.env.S3_REGION || 'auto',
    endpoint,
    pathStyle: forced ? forced === 'true' : !!endpoint,
    prefix: (process.env.S3_PREFIX ?? '').replace(/^\/+|\/+$/g, ''),
  }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()
/** RFC 3986 encoding, as SigV4 requires (encodeURIComponent leaves ! * ' ( ) unescaped). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export interface SignInput {
  method: string
  /** Absolute URL of the object. */
  url: string
  /** Extra headers to sign (host, x-amz-content-sha256 and x-amz-date are added). */
  headers?: Record<string, string>
  body?: Buffer
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Fixed time, for tests. */
  now?: Date
}

/** Returns the headers to send: the ones passed in plus host, x-amz-date, x-amz-content-sha256 and Authorization. */
export function signRequest(i: SignInput): Record<string, string> {
  const url = new URL(i.url)
  const amzDate = (i.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = sha256(i.body ?? '')
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(i.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])), host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalUri = url.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/'
  const query = [...url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
  const canonicalRequest = [i.method.toUpperCase(), canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${day}/${i.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + i.secretAccessKey, day), i.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}

export class S3Error extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function objectUrl(c: S3Config, key: string) {
  const path = [c.prefix, key].filter(Boolean).join('/').split('/').map(enc).join('/')
  if (c.endpoint) {
    const base = new URL(c.endpoint)
    return c.pathStyle ? `${base.origin}/${enc(c.bucket)}/${path}` : `${base.protocol}//${c.bucket}.${base.host}/${path}`
  }
  return c.pathStyle ? `https://s3.${c.region}.amazonaws.com/${enc(c.bucket)}/${path}` : `https://${c.bucket}.s3.${c.region}.amazonaws.com/${path}`
}

async function call(c: S3Config, method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer) {
  const url = objectUrl(c, key)
  const headers = signRequest({ method, url, body, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, headers: body ? { 'content-type': 'application/octet-stream' } : undefined })
  delete headers.host // fetch sets it
  const res = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined })
  if (!res.ok) throw new S3Error(res.status, `Object storage answered ${res.status} for ${method}`)
  return res
}

export async function s3Put(c: S3Config, key: string, data: Buffer) {
  await call(c, 'PUT', key, data)
}
export async function s3Get(c: S3Config, key: string): Promise<Buffer> {
  return Buffer.from(await (await call(c, 'GET', key)).arrayBuffer())
}
/** Deleting something that is not there is not an error (S3 answers 204 either way). */
export async function s3Delete(c: S3Config, key: string) {
  await call(c, 'DELETE', key)
}
