import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from 'next-themes'
import App from '../src/App'
import { AuthProvider } from '../src/lib/auth'
import { LanguageProvider } from '../src/lib/i18n'
import { AppearanceProvider } from '../src/lib/appearance'
import { PresenceProvider } from '../src/lib/presence'

// No real network: the chat and presence sockets are stubbed out.
vi.mock('socket.io-client', () => ({ io: () => ({ on: () => undefined, off: () => undefined, emit: () => undefined, disconnect: () => undefined, close: () => undefined, connected: false }) }))

type Person = { id: string; name: string; email: string; role: string; schoolId: string }
const PEOPLE: Record<string, Person & { password: string }> = {
  'student@school.test': { id: 's1', name: 'Sam Student', email: 'student@school.test', role: 'student', schoolId: 'sch', password: 'pw-student' },
  'admin@school.test': { id: 'a1', name: 'Alex Admin', email: 'admin@school.test', role: 'admin', schoolId: 'sch', password: 'pw-admin' },
  'super@platform.test': { id: 'p1', name: 'Pat Platform', email: 'super@platform.test', role: 'superadmin', schoolId: 'plat', password: 'pw-super' },
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let requested: string[]

/** A tiny stand-in for the API: real sign-in and /auth/me, empty lists for everything else. */
function fakeApi() {
  requested = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '')
    requested.push(`${init.method ?? 'GET'} ${path}`)
    if (path === '/auth/login') {
      const b = JSON.parse(String(init.body))
      const p = PEOPLE[b.email]
      return p && p.password === b.password ? json(200, { accessToken: `tok:${p.email}`, refreshToken: 'r' }) : json(401, { message: 'Invalid email or password' })
    }
    if (path === '/auth/me') {
      const auth = new Headers(init.headers as HeadersInit).get('authorization') ?? ''
      const p = PEOPLE[auth.replace('Bearer tok:', '')]
      return p ? json(200, { ...p, password: undefined, school: null }) : json(401, { message: 'no' })
    }
    if (path === '/home/todo') return json(200, { items: [] })
    if (path.startsWith('/attendance/student/')) return json(200, { student: { id: "s1", name: "Sam Student" }, days: 0, percent: null, recent: [] })
    if (path === '/messages/unread') return json(200, { count: 0 })
    return json(200, [])
  }))
}

function mount(startAt: string) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="light"><LanguageProvider><MemoryRouter initialEntries={[startAt]}>
      <AuthProvider><AppearanceProvider><PresenceProvider><App /></PresenceProvider></AppearanceProvider></AuthProvider>
    </MemoryRouter></LanguageProvider></ThemeProvider>,
  )
}

async function signIn(role: string | null, email: string, password: string) {
  if (role) await userEvent.click(await screen.findByRole('radio', { name: role }))
  await userEvent.clear(screen.getByLabelText('Email'))
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.clear(screen.getByLabelText('Password'))
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false }) })
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined })
  fakeApi()
})
afterEach(() => vi.unstubAllGlobals())

describe('signing in', () => {
  it('sends a signed-out visitor to the sign-in page, with a button for each school role and none for the super admin', async () => {
    mount('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'School Platform' })).toBeInTheDocument()
    const roles = screen.getAllByRole('radio').map((r) => r.textContent)
    expect(roles).toEqual(['student', 'parent', 'teacher', 'clerk', 'principal', 'admin'])
  })

  it('refuses a wrong password and stays on the sign-in page', async () => {
    mount('/login')
    await signIn('student', 'student@school.test', 'nope')
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('refuses the right password under the wrong role button', async () => {
    mount('/login')
    await signIn('admin', 'student@school.test', 'pw-student')
    expect(await screen.findByText(/not a admin/)).toBeInTheDocument()
    expect(localStorage.getItem('school.access')).toBeNull()
  })

  it('signs a student in and lands on Home', async () => {
    mount('/login')
    await signIn('student', 'student@school.test', 'pw-student')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument())
    expect(await screen.findByText('Sam Student', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(localStorage.getItem('school.access')).toBe('tok:student@school.test')
  })

  it('returns to the page a deep link asked for, once signed in', async () => {
    mount('/users')
    await signIn(null, 'admin@school.test', 'pw-admin')
    await waitFor(() => expect(requested.some((r) => r.startsWith('GET /users'))).toBe(true), { timeout: 3000 })
  })
})

describe('what each role may open', () => {
  it('keeps a student out of an admin-only page and sends them Home', async () => {
    localStorage.setItem('school.access', 'tok:student@school.test')
    mount('/users')
    await screen.findByText('Sam Student', {}, { timeout: 3000 })
    expect(requested.some((r) => r.startsWith('GET /users'))).toBe(false)
  })

  it('lets an admin open the admin page', async () => {
    localStorage.setItem('school.access', 'tok:admin@school.test')
    mount('/users')
    await waitFor(() => expect(requested.some((r) => r.startsWith('GET /users'))).toBe(true), { timeout: 3000 })
  })

  it('sends the super admin from Home to the list of schools', async () => {
    localStorage.setItem('school.access', 'tok:super@platform.test')
    mount('/')
    await waitFor(() => expect(requested.some((r) => r.includes('/platform/schools'))).toBe(true), { timeout: 3000 })
    expect(requested.some((r) => r.startsWith('GET /home/todo'))).toBe(false)
  })
})

describe('signing out', () => {
  it('does not send the next person back to the page the last one left', async () => {
    localStorage.setItem('school.access', 'tok:admin@school.test')
    mount('/users')
    await waitFor(() => expect(requested.some((r) => r.startsWith('GET /users'))).toBe(true), { timeout: 3000 })
    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(await screen.findByPlaceholderText("Search pages, classes, people…"), 'sign out')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem('school.access')).toBeNull()
    requested.length = 0
    await signIn('student', 'student@school.test', 'pw-student')
    await screen.findByText('Sam Student', {}, { timeout: 3000 })
    expect(requested.some((r) => r.startsWith('GET /users'))).toBe(false)
  })
})
