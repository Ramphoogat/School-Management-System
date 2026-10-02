import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { LanguageProvider } from '../src/lib/i18n'
import { Classes } from '../src/pages/Manage'

// Who is signed in: what they may do decides which buttons they get (the server enforces the same rules).
let me: { id: string; role: string } = { id: 'p1', role: 'principal' }
let allowed: string[] = []
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: me, can: (r: string, a: string) => allowed.includes(`${r}:${a}`) }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let calls: { method: string; path: string; body?: any }[]
let live: any[]
let deleted: any[]

const cls = (id: string, name: string, members = 3) => ({ id, name, classTeacherName: 'Demo Teacher', _count: { members }, channels: [{}, {}, {}] })

beforeEach(() => {
  calls = []
  live = [cls('c1', 'Grade 8-A'), cls('c2', 'Grade 9-B', 0)]
  deleted = [{ id: 'd1', name: 'Grade 7-C', deletedAt: '2026-09-30T10:00:00Z', deletedByName: 'Demo Principal', members: 12 }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
    if (method === 'GET' && path === '/classes') return json(live)
    if (method === 'GET' && path === '/classes/deleted') return json(deleted)
    if (method === 'DELETE' && /^\/classes\/c\d$/.test(path)) {
      const id = path.split('/')[2]
      const gone = live.find((c) => c.id === id)
      live = live.filter((c) => c.id !== id)
      deleted = [{ id, name: gone.name, deletedAt: new Date().toISOString(), deletedByName: 'Demo Principal', members: gone._count.members }, ...deleted]
      return json({ ok: true, id, name: gone.name })
    }
    if (method === 'POST' && /^\/classes\/\w+\/restore$/.test(path)) {
      const id = path.split('/')[2]
      const back = deleted.find((d) => d.id === id)
      deleted = deleted.filter((d) => d.id !== id)
      live = [...live, cls(id, back.name, back.members)]
      return json({ ok: true, id, name: back.name })
    }
    return json([])
  }))
})
afterEach(() => vi.unstubAllGlobals())

const mount = () => render(<LanguageProvider><MemoryRouter><Classes /></MemoryRouter></LanguageProvider>)
const asPrincipal = () => { me = { id: 'p1', role: 'principal' }; allowed = ['classes:write', 'classes:delete'] }

describe('deleting a class', () => {
  it('gives the principal a Delete button on every class, and a Deleted classes list', async () => {
    asPrincipal()
    mount()
    expect(await screen.findByRole('button', { name: 'Delete Grade 8-A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Grade 9-B' })).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'Deleted classes' })
    expect(within(section).getByText('Grade 7-C')).toBeInTheDocument()
    expect(within(section).getByText(/12 member\(s\)/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Restore Grade 7-C' })).toBeInTheDocument()
  })

  it('shows nobody else any of it: not the Delete buttons, not the deleted list, and the list is never even asked for', async () => {
    me = { id: 'x', role: 'clerk' }; allowed = ['classes:write'] // can create classes, cannot delete
    mount()
    await screen.findByText('Grade 8-A')
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Deleted classes' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/classes/deleted')).toBe(false)
  })

  it('asks first, says what will happen, and does nothing if cancelled', async () => {
    asPrincipal()
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Grade 8-A' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete Grade 8-A?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('3 member(s)')
    expect(dialog).toHaveTextContent('Nothing is erased')
    expect(dialog).toHaveTextContent('restore it at any time')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Grade 8-A')).toBeInTheDocument()
  })

  it('deletes after confirming, refreshes the lists and tells the side menu', async () => {
    asPrincipal()
    const heard = vi.fn()
    window.addEventListener('classes-changed', heard)
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Grade 8-A' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete class' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/classes/c1')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Grade 8-A' })).not.toBeInTheDocument())
    const section = screen.getByRole('region', { name: 'Deleted classes' })
    expect(await within(section).findByText('Grade 8-A')).toBeInTheDocument() // it moved to the deleted list
    expect(heard).toHaveBeenCalled()
    window.removeEventListener('classes-changed', heard)
  })
})

describe('restoring a class', () => {
  it('brings it back from the Deleted classes list', async () => {
    asPrincipal()
    const heard = vi.fn()
    window.addEventListener('classes-changed', heard)
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Grade 7-C' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/classes/d1/restore')).toBe(true))
    expect(await screen.findByRole('button', { name: 'Delete Grade 7-C' })).toBeInTheDocument() // back among the live classes
    expect(await screen.findByText('No deleted classes.')).toBeInTheDocument()
    expect(heard).toHaveBeenCalled()
    window.removeEventListener('classes-changed', heard)
  })

  it('says so when nothing has been deleted', async () => {
    asPrincipal()
    deleted = []
    mount()
    expect(await screen.findByText('No deleted classes.')).toBeInTheDocument()
  })
})
