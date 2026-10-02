import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshAccessToken, socketAuth, tokens } from '../src/lib/api'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
/** A token that looks like the real thing: only the expiry matters here. */
const jwt = (secondsFromNow: number) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.signature`
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('freshAccessToken', () => {
  it('returns nothing when nobody is signed in', async () => {
    tokens.clear()
    expect(await freshAccessToken()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a token that is still good, without asking the server', async () => {
    const good = jwt(600)
    tokens.set(good, 'R1')
    expect(await freshAccessToken()).toBe(good)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renews a token that has expired, and one about to', async () => {
    for (const left of [-3600, 10]) {
      const old = jwt(left), next = jwt(900)
      tokens.set(old, 'R1')
      fetchMock.mockResolvedValueOnce(json(200, { accessToken: next, refreshToken: 'R2' }))
      expect(await freshAccessToken(), `${left}s left`).toBe(next)
      expect(tokens.access).toBe(next)
      expect(tokens.refresh).toBe('R2')
    }
  })

  it('falls back to the token it has when the renewal fails (the sign-in is over)', async () => {
    const old = jwt(-60)
    tokens.set(old, 'R1')
    fetchMock.mockResolvedValueOnce(json(401, {}))
    expect(await freshAccessToken()).toBe(old)
  })

  it('uses a token it cannot read as it is', async () => {
    tokens.set('not-a-jwt', 'R1')
    expect(await freshAccessToken()).toBe('not-a-jwt')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the server once when several sockets reconnect at the same time', async () => {
    tokens.set(jwt(-60), 'R1')
    const next = jwt(900)
    fetchMock.mockResolvedValue(json(200, { accessToken: next, refreshToken: 'R2' }))
    const all = await Promise.all([freshAccessToken(), freshAccessToken(), freshAccessToken()])
    expect(all).toEqual([next, next, next])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('socketAuth', () => {
  it('hands each connection attempt a fresh token plus any extra fields', async () => {
    const next = jwt(900)
    tokens.set(jwt(-60), 'R1')
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: next, refreshToken: 'R2' }))
    const got = await new Promise<object>((resolve) => socketAuth(() => ({ status: 'invisible' }))(resolve))
    expect(got).toEqual({ token: next, status: 'invisible' })
  })
})
