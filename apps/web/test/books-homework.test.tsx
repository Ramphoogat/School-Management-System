import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '../src/lib/i18n'
import { Books } from '../src/components/Books'
import { Homework } from '../src/components/Homework'

// Who is signed in, for the Homework screen. The Books screen is told what it may do by the server.
let me: { id: string; role: string } = { id: 's1', role: 'student' }
let allowed: string[] = []
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: me, can: (r: string, a: string) => allowed.includes(`${r}:${a}`) }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let calls: { method: string; path: string; body?: any }[]
let routes: Record<string, (body: any) => unknown>

beforeEach(() => {
  calls = []; routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '')
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    const handler = routes[key] ?? Object.entries(routes).find(([k]) => key.startsWith(k.replace(/\*$/, '')) && k.endsWith('*'))?.[1]
    return handler ? json(handler(body)) : json([])
  }))
})
afterEach(() => vi.unstubAllGlobals())
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

const BOOKS = {
  canAdd: false, canRevoke: false, max: 100,
  books: [
    { id: 'b1', title: 'Maths Part 1', author: 'R. Sharma', description: 'Chapters 1 to 5', name: 'maths.pdf', mime: 'application/pdf', size: 2_500_000, createdAt: '2026-09-20T00:00:00Z', addedBy: 'Demo Teacher', revoked: false },
    { id: 'b2', title: 'Science Reader', author: null, description: null, name: 'sci.pdf', mime: 'application/pdf', size: 800_000, createdAt: '2026-09-21T00:00:00Z', addedBy: 'Demo Clerk', revoked: true },
  ],
}

describe('books channel', () => {
  it('shows a student their books, with a locked card and no buttons for a withdrawn one', async () => {
    routes['GET /books/class/c1'] = () => BOOKS
    wrap(<Books classId="c1" />)
    expect(await screen.findAllByText('Maths Part 1')).not.toHaveLength(0)
    const cards = screen.getAllByRole('listitem')
    const maths = cards.find((c) => within(c).queryByRole('heading', { name: 'Maths Part 1' }))!
    expect(within(maths).getByRole('button', { name: /read/i })).toBeInTheDocument()
    expect(within(maths).getByRole('button', { name: /download/i })).toBeInTheDocument()
    const science = cards.find((c) => within(c).queryByRole('heading', { name: 'Science Reader' }))!
    expect(within(science).getByRole('status')).toHaveTextContent(/withdrawn this book from you/i)
    expect(within(science).queryByRole('button', { name: /read/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a book/i })).not.toBeInTheDocument() // students cannot add
  })

  it('shows an empty class a friendly message', async () => {
    routes['GET /books/class/c1'] = () => ({ ...BOOKS, books: [] })
    wrap(<Books classId="c1" />)
    expect(await screen.findByText('Books your school shares with this class will appear here.')).toBeInTheDocument()
  })

  it('offers staff the add form, and a teacher cannot see the withdraw control', async () => {
    routes['GET /books/class/c1'] = () => ({ ...BOOKS, canAdd: true, books: [BOOKS.books[0]] })
    wrap(<Books classId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /add a book/i }))
    expect(screen.getByRole('form', { name: /add a book/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add book' })).toBeDisabled() // needs a title and a file
    expect(screen.queryByRole('button', { name: /who can use it/i })).not.toBeInTheDocument()
  })

  it('lets the principal withdraw a book from one student and give it back', async () => {
    routes['GET /books/class/c1'] = () => ({ ...BOOKS, canAdd: true, canRevoke: true, books: [{ ...BOOKS.books[0], revoked: undefined, revokedCount: 1 }] })
    let students = [{ id: 's1', name: 'Asha Rao', revoked: false, reason: null, since: null }, { id: 's2', name: 'Ben Roy', revoked: true, reason: 'Lost the printed copy', since: '2026-09-30T00:00:00Z' }]
    routes['GET /books/b1/access'] = () => ({ book: { id: 'b1', title: 'Maths Part 1' }, students })
    routes['POST /books/b1/revoke'] = (b) => { students = students.map((s) => (s.id === b.studentId ? { ...s, revoked: true, reason: b.reason ?? null } : s)); return { ok: true } }
    routes['POST /books/b1/restore'] = (b) => { students = students.map((s) => (s.id === b.studentId ? { ...s, revoked: false, reason: null } : s)); return { ok: true } }
    wrap(<Books classId="c1" />)
    expect(await screen.findByText('Withdrawn from 1 student(s)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /who can use it/i }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Ben Roy')).toBeInTheDocument()
    expect(within(dialog).getByText('Reason: Lost the printed copy')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Reason for withdrawing the book from Asha Rao'), 'Not enrolled for this module')
    const rows = within(dialog).getAllByRole('listitem')
    await userEvent.click(within(rows[0]).getByRole('button', { name: /withdraw/i }))
    await waitFor(() => expect(calls.find((c) => c.path === '/books/b1/revoke')?.body).toEqual({ studentId: 's1', reason: 'Not enrolled for this module' }))

    // Asha now shows as withdrawn too; give Ben's copy back.
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /give back/i })).toHaveLength(2))
    await userEvent.click(within(within(dialog).getAllByRole('listitem')[1]).getByRole('button', { name: /give back/i }))
    await waitFor(() => expect(calls.find((c) => c.path === '/books/b1/restore')?.body).toEqual({ studentId: 's2' }))
  })
})

const HW = [
  { id: 'h1', title: 'Fractions', description: 'Ex 4', dueDate: '2099-01-01', files: [], myFiles: [], mySubmission: { submittedAt: '2026-09-29T10:00:00Z', text: '3/4' }, submittedCount: 1, canReview: false },
  { id: 'h2', title: 'Past paper', description: '', dueDate: '2000-01-01', files: [], myFiles: [], mySubmission: null, submittedCount: 0, canReview: false },
  { id: 'h3', title: 'Reading log', description: 'Read for 20 minutes', dueDate: '2099-06-01', files: [], myFiles: [], mySubmission: null, submittedCount: 0, canReview: false },
]

describe('homework page for a student', () => {
  beforeEach(() => { me = { id: 's1', role: 'student' }; allowed = ['homework:read'] })

  it('summarises, puts the work to do first, and marks what is overdue', async () => {
    routes['GET /homework?classId=c1'] = () => HW
    wrap(<Homework classId="c1" />)
    await screen.findByText('Past paper')
    const stats = screen.getByRole('region', { name: 'Your homework at a glance' })
    const numbers = within(stats).getAllByRole('button').map((b) => b.textContent)
    expect(numbers).toEqual(['3All', '2To do', '1Overdue', '1Handed in'])
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Past paper', 'Reading log', 'Fractions']) // overdue first, handed in last
    expect(screen.getByText(/Overdue by \d+ days/)).toBeInTheDocument()
  })

  it('filters by the summary buttons and says when nothing matches', async () => {
    routes['GET /homework?classId=c1'] = () => [HW[0]]
    wrap(<Homework classId="c1" />)
    await screen.findByText('Fractions')
    await userEvent.click(within(screen.getByRole('region', { name: 'Your homework at a glance' })).getByRole('button', { name: /^0To do/ }))
    expect(await screen.findByText('You are all caught up.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all homework' }))
    expect(await screen.findByText('Fractions')).toBeInTheDocument()
  })

  it('hands work in from the card', async () => {
    routes['GET /homework?classId=c1'] = () => [HW[2]]
    routes['POST /homework/h3/submit'] = () => ({ ok: true })
    wrap(<Homework classId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /start your work/i }))
    const hand = screen.getByRole('button', { name: /hand in/i })
    expect(hand).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your answer'), 'Read chapter 3')
    await userEvent.click(hand)
    await waitFor(() => expect(calls.find((c) => c.path === '/homework/h3/submit')?.body).toEqual({ text: 'Read chapter 3' }))
  })

  it('shows an empty state with no homework', async () => {
    routes['GET /homework?classId=c1'] = () => []
    wrap(<Homework classId="c1" />)
    expect(await screen.findByText('New assignments from your teacher will appear here.')).toBeInTheDocument()
  })
})

describe('homework page for a teacher', () => {
  beforeEach(() => { me = { id: 't1', role: 'teacher' }; allowed = ['homework:write'] })

  it('shows how many have handed in, lists who, and opens the form for new homework', async () => {
    routes['GET /homework?classId=c1'] = () => [{ ...HW[2], canReview: true, submittedCount: 1, studentCount: 4 }]
    routes['GET /homework/h3/submissions'] = () => [
      { studentId: 'a', name: 'Asha Rao', submittedAt: '2026-09-30T10:00:00Z', text: 'done', files: [] },
      { studentId: 'b', name: 'Ben Roy', submittedAt: null, files: [] },
    ]
    routes['GET /classes'] = () => [{ id: 'c1', name: 'Grade 8-A' }]
    wrap(<Homework classId="c1" />)
    expect(await screen.findByText('1 of 4 handed in')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    await userEvent.click(screen.getByRole('button', { name: /see who handed in/i }))
    expect(await screen.findByText('Ben Roy')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /new homework/i }))
    expect(await screen.findByRole('button', { name: 'Assign homework' })).toBeDisabled() // needs a title
  })
})
