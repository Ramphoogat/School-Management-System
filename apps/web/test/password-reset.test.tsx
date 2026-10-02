import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ForgotPassword, ResetPassword } from '../src/pages/PasswordReset'
import { LanguageProvider } from '../src/lib/i18n'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

const mount = (start: string) => render(
  <LanguageProvider><MemoryRouter initialEntries={[start]}>
    <Routes>
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/login" element={<p>SIGN IN PAGE</p>} />
    </Routes>
  </MemoryRouter></LanguageProvider>,
)
const sentBody = () => JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))

describe('forgot password page', () => {
  it('asks for the link and then says the same thing whatever the address', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(201, { ok: true }))
    mount('/forgot-password')
    const send = screen.getByRole('button', { name: 'Send the link' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com')
    await userEvent.click(send)
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(screen.getByText(/If that address belongs to an account/)).toBeInTheDocument()
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/api\/auth\/forgot-password$/)
    expect(sentBody()).toMatchObject({ email: 'someone@example.com' })
  })

  it('stays on the form and shows the wait when the server says too many tries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(429, { message: 'Too many password reset requests for this address. Try again in 40 minutes.' }))
    mount('/forgot-password')
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument()
  })
})

describe('reset password page', () => {
  it('needs 8 characters and two matching entries before it lets you save', async () => {
    mount('/reset-password?token=abc')
    const save = screen.getByRole('button', { name: 'Change password' })
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'short')
    expect(save).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.clear(screen.getByLabelText('Type the new password again'))
    await userEvent.type(screen.getByLabelText('New password'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'long-enough-2')
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.')
    expect(save).toBeDisabled()
  })

  it('sends the link secret with the new password, then goes to sign in', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(201, { ok: true }))
    mount('/reset-password?token=the-secret-from-the-email&school=greenfield')
    await userEvent.type(screen.getByLabelText('New password'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('SIGN IN PAGE')).toBeInTheDocument()
    expect(sentBody()).toEqual({ token: 'the-secret-from-the-email', newPassword: 'long-enough-1' })
  })

  it('offers a new link when the server refuses this one, or when there is no token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(400, { message: 'This link is not valid any more. Ask for a new one.' }))
    const first = mount('/reset-password?token=old-one')
    await userEvent.type(screen.getByLabelText('New password'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Type the new password again'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('This link cannot be used')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get a new link' })).toHaveAttribute('href', '/forgot-password')
    first.unmount()

    mount('/reset-password')
    expect(screen.getByText('This link cannot be used')).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})
