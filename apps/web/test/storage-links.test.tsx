import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '../src/lib/i18n'
import { AddFromLink, SourceHelp } from '../src/components/LinkImport'
import { Books } from '../src/components/Books'
import { StorageSettings } from '../src/pages/Storage'
import { formatBytes } from '../src/lib/bytes'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let calls: { method: string; path: string; body?: any }[]
let routes: Record<string, (body: any) => { status?: number; body: unknown }>

beforeEach(() => {
  calls = []; routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '')
    const method = init.method ?? (init.body ? 'POST' : 'GET')
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const h = routes[`${method} ${path}`]
    if (!h) return json([])
    const r = h(body)
    return json(r.body, r.status ?? 200)
  }))
})
afterEach(() => vi.unstubAllGlobals())
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

const SOURCES = {
  canUseLinks: true, maxMb: 100, allowed: 'PDF, PNG, JPG, DOC, DOCX, TXT', driveConnected: true, shareWith: 'robot@school.iam.gserviceaccount.com',
  sources: [
    { id: 'gdrive', name: 'Google Drive file', example: 'https://drive.google.com/file/d/…/view', how: 'Open the file in Google Drive and choose Share.' },
    { id: 'dropbox', name: 'Dropbox', example: 'https://www.dropbox.com/s/…/notes.pdf', how: 'Choose Share, then create a link.' },
    { id: 'direct', name: 'Any direct file link', example: 'https://example.com/files/timetable.pdf', how: 'A link that goes straight to a file.' },
  ],
  notSupported: ['Links that ask you to sign in.', 'Web pages that are not a file.'],
}

describe('formatBytes', () => {
  it('writes sizes the way people read them', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
    expect(formatBytes(null)).toBe('—')
  })
})

describe('the ? help button', () => {
  it('shows which sources work and how, when it is clicked', async () => {
    routes['GET /import/sources'] = () => ({ body: SOURCES })
    wrap(<SourceHelp />)
    expect(calls).toHaveLength(0) // nothing is fetched until it is opened
    await userEvent.click(screen.getByRole('button', { name: 'Which links can I use?' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Google Drive file')).toBeInTheDocument()
    expect(within(dialog).getByText('Dropbox')).toBeInTheDocument()
    expect(within(dialog).getByText('Any direct file link')).toBeInTheDocument()
    expect(within(dialog).getByText(/Files up to 100 MB; PDF, PNG, JPG, DOC, DOCX, TXT/)).toBeInTheDocument()
    expect(within(dialog).getByText('robot@school.iam.gserviceaccount.com')).toBeInTheDocument() // the address to share a private Drive file with
    expect(within(dialog).getByText('Links that ask you to sign in.')).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/import/sources')).toHaveLength(1)
  })

  it('says nothing about a Drive address when Drive is not connected', async () => {
    routes['GET /import/sources'] = () => ({ body: { ...SOURCES, driveConnected: false, shareWith: null } })
    wrap(<SourceHelp />)
    await userEvent.click(screen.getByRole('button', { name: 'Which links can I use?' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Dropbox')
    expect(within(dialog).queryByText(/share it \(as Viewer\) with/)).not.toBeInTheDocument()
  })
})

describe('adding a file from a link', () => {
  it('sends the link (and any extra fields) to the place that takes uploads, then closes', async () => {
    routes['POST /documents'] = () => ({ body: { id: 'd1' } })
    const done = vi.fn()
    wrap(<AddFromLink path="/documents" extra={{ title: 'Term plan' }} onDone={done} />)
    await userEvent.click(screen.getByRole('button', { name: 'From a link' }))
    const dialog = await screen.findByRole('dialog')
    const add = within(dialog).getByRole('button', { name: 'Add file' })
    expect(add).toBeDisabled() // nothing pasted yet
    await userEvent.type(within(dialog).getByLabelText('Link'), '  https://www.dropbox.com/s/abc/plan.pdf?dl=0  ')
    await userEvent.click(add)
    await waitFor(() => expect(calls.find((c) => c.path === '/documents')?.body).toEqual({ title: 'Term plan', url: 'https://www.dropbox.com/s/abc/plan.pdf?dl=0' }))
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and shows the reason when the school could not fetch the link', async () => {
    routes['POST /resources/class/c1'] = () => ({ status: 400, body: { message: 'That link opens a web page, not a file. If the file is private, set it to "Anyone with the link can view" and try again.' } })
    const done = vi.fn()
    wrap(<AddFromLink path="/resources/class/c1" onDone={done} />)
    await userEvent.click(screen.getByRole('button', { name: 'From a link' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Link'), 'https://example.com/login')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add file' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('opens a web page, not a file')
    expect(done).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The link is still there to correct.
    expect(within(dialog).getByLabelText('Link')).toHaveValue('https://example.com/login')
  })

  it('has the ? help right inside the dialog', async () => {
    routes['GET /import/sources'] = () => ({ body: SOURCES })
    wrap(<AddFromLink path="/documents" onDone={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'From a link' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Which links can I use?' }))
    expect(await screen.findByText('Dropbox')).toBeInTheDocument()
  })
})

describe('adding a book from a link', () => {
  const list = { canAdd: true, canRevoke: false, max: 100, books: [] }

  it('offers "From this device" and "From a link", and sends the link with the title', async () => {
    routes['GET /books/class/c1'] = () => ({ body: list })
    routes['POST /books/class/c1'] = () => ({ body: { id: 'b1' } })
    wrap(<Books classId="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /add a book/i }))
    const form = screen.getByRole('form', { name: /add a book/i })
    expect(within(form).getByRole('button', { name: 'From this device' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(form).getByRole('button', { name: 'From a link' }))
    expect(within(form).getByRole('button', { name: 'Which links can I use?' })).toBeInTheDocument() // the ? appears with the link box
    const add = within(form).getByRole('button', { name: 'Add book' })
    expect(add).toBeDisabled()
    await userEvent.type(within(form).getByLabelText('Book title'), 'Maths Part 1')
    await userEvent.type(within(form).getByLabelText('Link to the book'), 'https://drive.google.com/file/d/AbCdEfGhIjKlMnOp/view')
    await userEvent.click(add)
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/books/class/c1')?.body).toEqual({ title: 'Maths Part 1', url: 'https://drive.google.com/file/d/AbCdEfGhIjKlMnOp/view' }))
  })
})

const STATUS = {
  mode: 'auto', activeNow: 'primary', reason: 'auto-main',
  main: { kind: 's3', usedBytes: 3 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, schoolBytes: 2 * 1024 ** 3, schoolFiles: 120 },
  drive: { configured: true, shareWith: 'robot@school.iam.gserviceaccount.com', usedBytes: 0, schoolBytes: 0, schoolFiles: 0, account: 'robot@school.iam.gserviceaccount.com', quotaLimitBytes: 15 * 1024 ** 3, quotaUsedBytes: 1024 ** 3, error: null },
}

describe('the Storage page', () => {
  it('shows where new files go right now, and the room used in both places', async () => {
    routes['GET /storage'] = () => ({ body: STATUS })
    wrap(<StorageSettings />)
    expect(await screen.findByText('Right now: main storage.')).toBeInTheDocument()
    expect(screen.getByText('The main storage has room, so new files go there.')).toBeInTheDocument()
    const main = screen.getByRole('region', { name: 'Main storage' })
    expect(within(main).getByText('3.0 GB of 10.0 GB')).toBeInTheDocument()
    expect(within(main).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
    expect(within(main).getByText('Cloud bucket')).toBeInTheDocument()
    const drive = screen.getByRole('region', { name: 'Google Drive' })
    expect(within(drive).getByText('Connected')).toBeInTheDocument()
    expect(within(drive).getByText('1.0 GB of 15.0 GB')).toBeInTheDocument()
  })

  it('says so plainly when the main storage is full and Drive has taken over', async () => {
    routes['GET /storage'] = () => ({ body: { ...STATUS, activeNow: 'drive', reason: 'auto-main-full', main: { ...STATUS.main, usedBytes: 10 * 1024 ** 3 } } })
    wrap(<StorageSettings />)
    expect(await screen.findByText('Right now: Google Drive.')).toBeInTheDocument()
    expect(screen.getByText('The main storage is full, so new files are going to Google Drive.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Main storage' })).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('lets the person choose, and saves it', async () => {
    routes['GET /storage'] = () => ({ body: STATUS })
    routes['PUT /storage/mode'] = (b) => ({ body: { ...STATUS, mode: b.mode, activeNow: b.mode === 'drive' ? 'drive' : 'primary', reason: b.mode === 'drive' ? 'chosen-drive' : 'chosen-main' } })
    wrap(<StorageSettings />)
    const group = await screen.findByRole('radiogroup', { name: 'Where new files go' })
    expect(within(group).getByRole('radio', { name: /Automatic/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: /Google Drive only/ }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/storage/mode')?.body).toEqual({ mode: 'drive' }))
    expect(await screen.findByText('Right now: Google Drive.')).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Where new files go' })).getByRole('radio', { name: /Google Drive only/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('does not offer Google Drive when it is not connected', async () => {
    routes['GET /storage'] = () => ({ body: { ...STATUS, reason: 'drive-not-set-up', drive: { ...STATUS.drive, configured: false, shareWith: null, account: null, quotaLimitBytes: null, quotaUsedBytes: null } } })
    wrap(<StorageSettings />)
    const group = await screen.findByRole('radiogroup', { name: 'Where new files go' })
    expect(within(group).getByRole('radio', { name: /Google Drive only/ })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Google Drive' })).getByText('Not connected')).toBeInTheDocument()
    expect(within(group).getByText('Needs Google Drive to be connected first.')).toBeInTheDocument()
  })

  it('runs the test and shows each step, marking the ones that failed', async () => {
    routes['GET /storage'] = () => ({ body: STATUS })
    routes['POST /storage/check'] = () => ({
      body: {
        main: { kind: 's3', steps: [{ step: 'save a file', ok: true, ms: 120 }, { step: 'read it back and compare', ok: true, ms: 80 }] },
        drive: { steps: [{ step: 'sign in to Google', ok: true, ms: 300 }, { step: 'save a file in the folder', ok: false, ms: 50, error: 'Google Drive refused to start the upload (403: quota)' }] },
      },
    })
    wrap(<StorageSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Run the test' }))
    expect(await screen.findByText(/save a file in the folder/)).toBeInTheDocument()
    expect(screen.getByText('Google Drive refused to start the upload (403: quota)')).toBeInTheDocument()
    expect(screen.getAllByLabelText('worked')).toHaveLength(3)
    expect(screen.getAllByLabelText('failed')).toHaveLength(1)
  })
})
