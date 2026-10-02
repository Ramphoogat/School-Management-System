import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Keeps a stored secret (a Google refresh token) unreadable in a database copy. The key comes from the server's JWT_SECRET. */
const key = () => createHash('sha256').update(`drive-token|${process.env.JWT_SECRET ?? ''}`).digest()

export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

export function openSecret(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
  const d = createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(body), d.final()]).toString('utf8')
}
