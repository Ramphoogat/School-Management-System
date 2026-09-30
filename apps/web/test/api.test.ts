import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, tokens } from '../src/lib/api'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('api()', () => {
  it('sends the bearer token and returns the JSON', async () => {
    tokens.set('A1', 'R1')
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }))
    expect(await api('/me')).toEqual({ ok: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/me$/)
    expect(init.headers.authorization).toBe('Bearer A1')
    expect(init.method).toBe('GET')
  })
  it('uses POST when there is a body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}))
    await api('/x', { body: { a: 1 } })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
  it('turns an error response into an ApiError, joining validation messages', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { message: ['name is required', 'email is invalid'] }))
    await expect(api('/x')).rejects.toMatchObject({ status: 400, message: 'name is required, email is invalid' })
  })
  it('refreshes an expired token once, stores the new pair and retries', async () => {
    tokens.set('OLD', 'R1')
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'NEW', refreshToken: 'R2' }))
      .mockResolvedValueOnce(json(200, { done: true }))
    expect(await api('/secure')).toEqual({ done: true })
    expect(tokens.access).toBe('NEW')
    expect(tokens.refresh).toBe('R2')
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe('Bearer NEW')
  })
  it('gives up with a 401 when the refresh fails, without looping', async () => {
    tokens.set('OLD', 'R1')
    fetchMock.mockResolvedValueOnce(json(401, { message: 'expired' })).mockResolvedValueOnce(json(401, {}))
    const err = await api('/secure').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not try to refresh when signed out', async () => {
    tokens.clear()
    fetchMock.mockResolvedValueOnce(json(401, { message: 'no' }))
    await expect(api('/secure')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
