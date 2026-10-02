import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'

/** Values people leave in from .env.example. A secret containing any of these is not a secret. */
const PLACEHOLDERS = ['change-me', 'changeme', 'secret', 'password', 'test-access', 'test-refresh', 'example', 'your-']
const DEMO_PASSWORDS = ['password123', 'password', 'admin123', '12345678']

/**
 * What is wrong with the settings that protect sign-in, as plain sentences. Empty means fine.
 * In production the API refuses to start if there is any; elsewhere it only warns.
 */
export function secretProblems(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const check = (name: string) => {
    const v = env[name] ?? ''
    if (!v) out.push(`${name} is not set.`)
    else if (v.length < 32) out.push(`${name} is too short (${v.length} characters). Use at least 32 random characters.`)
    else if (PLACEHOLDERS.some((p) => v.toLowerCase().includes(p))) out.push(`${name} still looks like a placeholder. Generate a real one.`)
  }
  check('JWT_SECRET')
  check('JWT_REFRESH_SECRET')
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) out.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values.')
  const pw = env.SUPERADMIN_PASSWORD
  if (env.SUPERADMIN_EMAIL && pw && (DEMO_PASSWORDS.includes(pw.toLowerCase()) || pw.length < 12)) out.push('SUPERADMIN_PASSWORD is a demo or short password. Use at least 12 characters.')
  const origins = (env.WEB_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  if (!origins.length || origins.some((o) => /localhost|127\.0\.0\.1/.test(o) || !o.startsWith('https://'))) out.push('WEB_ORIGIN must be the real https:// address of the web app (not localhost, not http).')
  return out
}

/** Stops the API from starting in production with weak sign-in settings. */
export function enforceSecrets(env: Record<string, string | undefined> = process.env, log: (m: string) => void = console.warn) {
  const problems = secretProblems(env)
  if (!problems.length) return
  if (env.NODE_ENV === 'production') {
    throw new Error(`The API will not start with unsafe settings:\n - ${problems.join('\n - ')}\nFix them in .env (see SERVICES.md, section 12).`)
  }
  log(`[security] Unsafe settings (fine on your own computer, refused when NODE_ENV=production):\n - ${problems.join('\n - ')}`)
}

/** Headers that stop common browser attacks. Set on every response. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), payment=()')
  // Only meaningful over HTTPS; browsers ignore it on plain HTTP. Behind Nginx the request is HTTPS when TRUST_PROXY is set.
  if (req.secure || process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  next()
}

/**
 * Applies the security settings shared by the real server and the tests.
 * TRUST_PROXY: how many proxies (Nginx) sit in front of the API, usually 1. Without it the address in the logs and in the
 * sign-in limiter would be the proxy's for everyone. Leave it unset if the API is reached directly, because then the
 * forwarded address can be forged.
 */
export function applySecurity(app: NestExpressApplication) {
  app.disable('x-powered-by')
  const hops = Number(process.env.TRUST_PROXY)
  if (Number.isInteger(hops) && hops > 0) app.set('trust proxy', hops)
  app.use(securityHeaders)
}
