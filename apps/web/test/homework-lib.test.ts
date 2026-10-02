import { describe, expect, it } from 'vitest'
import { daysUntil, dueLabel, matchesFilter, sortForStudent, summarize, toneOf } from '../src/lib/homework'

const t = (msg: string, vars?: Record<string, string | number>) => (vars ? msg.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : msg)
const TODAY = '2026-10-01'
const hw = (dueDate: string, submitted = false) => ({ dueDate, mySubmission: submitted ? { submittedAt: '2026-09-30T10:00:00Z' } : null })

describe('daysUntil', () => {
  it('counts whole calendar days, forward and back', () => {
    expect(daysUntil('2026-10-01', TODAY)).toBe(0)
    expect(daysUntil('2026-10-04', TODAY)).toBe(3)
    expect(daysUntil('2026-09-29', TODAY)).toBe(-2)
    expect(daysUntil('2026-10-31T00:00:00.000Z', TODAY)).toBe(30) // a full date-time works too
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1) // across a year end
  })
})

describe('dueLabel', () => {
  it('says it in plain words', () => {
    expect(dueLabel('2026-10-01', TODAY, t)).toBe('Due today')
    expect(dueLabel('2026-10-02', TODAY, t)).toBe('Due tomorrow')
    expect(dueLabel('2026-10-05', TODAY, t)).toBe('Due in 4 days')
    expect(dueLabel('2026-09-30', TODAY, t)).toBe('Overdue by 1 day')
    expect(dueLabel('2026-09-26', TODAY, t)).toBe('Overdue by 5 days')
  })
  it('falls back to the date when it is more than a week away', () => {
    expect(dueLabel('2026-10-20', TODAY, t)).toMatch(/^Due .*20/)
    expect(dueLabel('2026-10-20', TODAY, t)).not.toMatch(/days/)
  })
})

describe('toneOf', () => {
  it('is done once handed in, even if late', () => {
    expect(toneOf(hw('2026-09-01', true), TODAY)).toBe('done')
  })
  it('is overdue, soon (today to 2 days) or open', () => {
    expect(toneOf(hw('2026-09-30'), TODAY)).toBe('overdue')
    expect(toneOf(hw('2026-10-01'), TODAY)).toBe('soon')
    expect(toneOf(hw('2026-10-03'), TODAY)).toBe('soon')
    expect(toneOf(hw('2026-10-04'), TODAY)).toBe('open')
  })
})

describe('sorting, counting and filtering for a student', () => {
  const rows = [hw('2026-10-10'), hw('2026-09-20', true), hw('2026-09-28'), hw('2026-10-02'), hw('2026-09-25', true)]

  it('lists what is still to do first, soonest due on top, then what was handed in, newest first', () => {
    expect(sortForStudent(rows).map((r) => r.dueDate)).toEqual(['2026-09-28', '2026-10-02', '2026-10-10', '2026-09-25', '2026-09-20'])
  })
  it('does not change the list it was given', () => {
    const copy = [...rows]
    sortForStudent(rows)
    expect(rows).toEqual(copy)
  })
  it('counts to do, overdue, due soon and handed in', () => {
    expect(summarize(rows, TODAY)).toEqual({ total: 5, todo: 3, overdue: 1, dueSoon: 1, done: 2 })
    expect(summarize([], TODAY)).toEqual({ total: 0, todo: 0, overdue: 0, dueSoon: 0, done: 0 })
  })
  it('filters the same way the counts are made', () => {
    const count = (f: 'all' | 'todo' | 'done' | 'overdue') => rows.filter((r) => matchesFilter(r, f, TODAY)).length
    expect([count('all'), count('todo'), count('overdue'), count('done')]).toEqual([5, 3, 1, 2])
  })
})
