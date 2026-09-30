import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { apiList } from '../src/lib/api'
import { CutOffNotice } from '../src/components/CutOffNotice'
import { LanguageProvider } from '../src/lib/i18n'

const reply = (rows: unknown[], headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(status === 200 ? rows : { message: 'nope' }), { status, headers: { 'content-type': 'application/json', ...headers } })
beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('apiList', () => {
  it('returns the rows with the total from the header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply([1, 2, 3], { 'x-total-count': '812' }))
    expect(await apiList('/students')).toEqual({ rows: [1, 2, 3], total: 812 })
  })
  it('falls back to the row count when there is no header or it is nonsense', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply([1, 2]))
    expect(await apiList('/x')).toEqual({ rows: [1, 2], total: 2 })
    vi.mocked(fetch).mockResolvedValueOnce(reply([1, 2], { 'x-total-count': 'abc' }))
    expect((await apiList('/x')).total).toBe(2)
    vi.mocked(fetch).mockResolvedValueOnce(reply([1, 2, 3], { 'x-total-count': '1' })) // never less than what we hold
    expect((await apiList('/x')).total).toBe(3)
  })
  it('turns a failure into an error with the server message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply([], {}, 403))
    await expect(apiList('/x')).rejects.toMatchObject({ status: 403, message: 'nope' })
  })
})

describe('CutOffNotice', () => {
  it('warns when rows are hidden and says how many exist', () => {
    render(<LanguageProvider><CutOffNotice shown={300} total={812} /></LanguageProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Showing the first 300 of 812. Use the search or filters to find the rest.')
  })
  it('says nothing when everything is shown', () => {
    render(<LanguageProvider><CutOffNotice shown={40} total={40} /></LanguageProvider>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
