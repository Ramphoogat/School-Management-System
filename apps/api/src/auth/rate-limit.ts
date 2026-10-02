import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Counts failures per key in a sliding window and refuses further tries once the limit is reached.
 * It lives in this process's memory, which is right while there is one API server (see docs/DEPLOYMENT.md);
 * with several servers each would count separately, and it would need to move to Redis.
 */
export class FailureLimiter {
  private hits = new Map<string, { count: number; first: number }>()

  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {
    const timer = setInterval(() => this.sweep(), Math.max(60_000, windowMs))
    timer.unref?.() // never keep the process alive just for this
  }

  private sweep() {
    const t = this.now()
    for (const [k, v] of this.hits) if (t - v.first >= this.windowMs) this.hits.delete(k)
  }

  /** Minutes left until this key may try again, or 0 if it may try now. */
  waitMinutes(key: string): number {
    const v = this.hits.get(key)
    if (!v) return 0
    const left = this.windowMs - (this.now() - v.first)
    if (left <= 0) { this.hits.delete(key); return 0 }
    return v.count >= this.max ? Math.ceil(left / 60_000) : 0
  }

  /** Throws 429 if the key is locked out. */
  check(key: string, what = 'attempts') {
    const wait = this.waitMinutes(key)
    if (wait > 0) throw new HttpException(`Too many ${what}. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS)
  }

  fail(key: string) {
    const t = this.now()
    const v = this.hits.get(key)
    if (!v || t - v.first >= this.windowMs) this.hits.set(key, { count: 1, first: t })
    else v.count++
  }

  clear(key: string) { this.hits.delete(key) }
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
export const LOGIN_WINDOW_MS = num(process.env.LOGIN_WINDOW_MINUTES, 15) * 60_000
/** Wrong passwords allowed for one email address in the window. */
export const LOGIN_MAX_PER_EMAIL = num(process.env.LOGIN_MAX_PER_EMAIL, 10)
/** Wrong passwords allowed from one network address in the window (a whole school may share one). */
export const LOGIN_MAX_PER_IP = num(process.env.LOGIN_MAX_PER_IP, 60)
/** Wrong current-password tries allowed on one account when changing the password. */
export const PASSWORD_MAX = 5
