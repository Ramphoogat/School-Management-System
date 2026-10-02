import type { T } from './i18n'

/** What a piece of homework looks like to the student, which decides its colour and where it is listed. */
export type HomeworkTone = 'overdue' | 'soon' | 'open' | 'done'

export interface HomeworkLike { dueDate: string; mySubmission?: { submittedAt: string } | null }

const DAY = 86_400_000
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY)

/** Whole calendar days from today until the due date: 0 is today, negative is late. */
export function daysUntil(due: string, today: string): number {
  return dayNumber(due) - dayNumber(today)
}

/** "Due today", "Due in 3 days", "Overdue by 2 days", or the plain date when it is far off. */
export function dueLabel(due: string, today: string, t: T): string {
  const d = daysUntil(due, today)
  if (d < -1) return t('Overdue by {n} days', { n: -d })
  if (d === -1) return t('Overdue by 1 day')
  if (d === 0) return t('Due today')
  if (d === 1) return t('Due tomorrow')
  if (d <= 7) return t('Due in {n} days', { n: d })
  return t('Due {date}', { date: new Date(`${due.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) })
}

export function toneOf(a: HomeworkLike, today: string): HomeworkTone {
  if (a.mySubmission) return 'done'
  const d = daysUntil(a.dueDate, today)
  if (d < 0) return 'overdue'
  return d <= 2 ? 'soon' : 'open'
}

/** To do first (the most urgent on top), then what has been handed in (the newest due date first). */
export function sortForStudent<A extends HomeworkLike>(rows: A[]): A[] {
  const rank = (a: A) => (a.mySubmission ? 1 : 0)
  return [...rows].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.dueDate.localeCompare(b.dueDate) : b.dueDate.localeCompare(a.dueDate)))
}

export interface HomeworkSummary { todo: number; overdue: number; done: number; dueSoon: number; total: number }

export function summarize(rows: HomeworkLike[], today: string): HomeworkSummary {
  const s: HomeworkSummary = { todo: 0, overdue: 0, done: 0, dueSoon: 0, total: rows.length }
  for (const a of rows) {
    const tone = toneOf(a, today)
    if (tone === 'done') s.done++
    else { s.todo++; if (tone === 'overdue') s.overdue++; if (tone === 'soon') s.dueSoon++ }
  }
  return s
}

export type HomeworkFilter = 'all' | 'todo' | 'done' | 'overdue'

export function matchesFilter(a: HomeworkLike, f: HomeworkFilter, today: string): boolean {
  const tone = toneOf(a, today)
  return f === 'all' || (f === 'done' ? tone === 'done' : f === 'overdue' ? tone === 'overdue' : tone !== 'done')
}
