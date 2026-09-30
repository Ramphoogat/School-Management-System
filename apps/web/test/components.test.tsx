import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider, useT } from '../src/lib/i18n'
import { Pager, usePaged } from '../src/components/Pager'

const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

describe('Pager', () => {
  it('shows the range and moves between pages', async () => {
    const onPage = vi.fn()
    wrap(<Pager page={2} pages={5} total={47} pageSize={10} onPage={onPage} />)
    expect(screen.getByText('Showing 11–20 of 47')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPage).toHaveBeenLastCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: 'Last page' }))
    expect(onPage).toHaveBeenLastCalledWith(5)
  })
  it('disables back buttons on page 1, marks the current page, and hides itself for one page', () => {
    const { rerender } = wrap(<Pager page={1} pages={3} total={30} pageSize={10} onPage={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')
    rerender(<LanguageProvider><Pager page={1} pages={1} total={4} pageSize={10} onPage={() => undefined} /></LanguageProvider>)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('says 0–0 for an empty list', () => {
    wrap(<Pager page={1} pages={1} total={0} pageSize={10} onPage={() => undefined} />)
    expect(screen.getByText('Showing 0–0 of 0')).toBeInTheDocument()
  })
})

describe('usePaged', () => {
  it('slices rows and stays on a valid page when the list shrinks', () => {
    const { result, rerender } = renderHook(({ rows }) => usePaged(rows, 10), { initialProps: { rows: Array.from({ length: 25 }, (_, i) => i) } })
    act(() => result.current.props.onPage(3))
    expect(result.current.items).toEqual([20, 21, 22, 23, 24])
    rerender({ rows: [1, 2, 3] })
    expect(result.current.props.page).toBe(1)
    expect(result.current.items).toEqual([1, 2, 3])
  })
})

function Probe() {
  const { t, lang, setLang } = useT()
  return (
    <div>
      <p>{t('Sign in')}</p>
      <p>{t('Showing {from}–{to} of {total}', { from: 1, to: 2, total: 3 })}</p>
      <p>{t('Not in any dictionary')}</p>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang('hi')}>hindi</button>
    </div>
  )
}

describe('i18n', () => {
  it('falls back to English text and fills {placeholders}', () => {
    wrap(<Probe />)
    expect(screen.getByText('Sign in')).toBeInTheDocument()
    expect(screen.getByText('Showing 1–2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Not in any dictionary')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
  })
  it('switches language, saves the choice and translates known text', async () => {
    wrap(<Probe />)
    await userEvent.click(screen.getByText('hindi'))
    await waitFor(() => expect(screen.queryByText('Sign in')).not.toBeInTheDocument())
    expect(screen.getByText('Not in any dictionary')).toBeInTheDocument()
    expect(localStorage.getItem('language')).toBe('hi')
    expect(document.documentElement.lang).toBe('hi')
  })
  it('starts in the saved language', () => {
    localStorage.setItem('language', 'ta')
    wrap(<Probe />)
    expect(screen.getByTestId('lang')).toHaveTextContent('ta')
  })
})
