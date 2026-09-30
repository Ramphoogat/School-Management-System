export interface Quiet { start: string; end: string; timezone: string }

export const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

export function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true } catch { return false }
}

/** The person's clock, in minutes since midnight, in their timezone. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour')!.value) % 24
  const m = Number(parts.find((p) => p.type === 'minute')!.value)
  return h * 60 + m
}

/**
 * If it is currently quiet hours for this person, the moment the window ends; otherwise null. Windows can cross midnight
 * (22:00 to 07:00). Start equal to end means no window.
 */
export function quietUntil(now: Date, q: Quiet): Date | null {
  const s = minutes(q.start), e = minutes(q.end)
  if (s === e) return null
  let cur: number
  try { cur = localMinutes(now, q.timezone) } catch { return null }
  const inside = s < e ? cur >= s && cur < e : cur >= s || cur < e
  if (!inside) return null
  const wait = (e - cur + 1440) % 1440 // minutes until the window ends
  return new Date(now.getTime() + wait * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds())
}
