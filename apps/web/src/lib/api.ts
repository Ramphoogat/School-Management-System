const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/** A full address on the API server, for things a plain <img> or link has to load. */
export const apiUrl = (path: string) => `${BASE}${path}`

const ACCESS = 'school.access'
const REFRESH = 'school.refresh'

export const tokens = {
  get access() { return localStorage.getItem(ACCESS) },
  get refresh() { return localStorage.getItem(REFRESH) },
  set(a: string, r: string) { localStorage.setItem(ACCESS, a); localStorage.setItem(REFRESH, r) },
  clear() { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH) },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let refreshing: Promise<boolean> | null = null
async function refreshTokens(): Promise<boolean> {
  const r = tokens.refresh
  if (!r) return false
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: r }),
  })
    .then(async (res) => {
      if (!res.ok) return false
      const d = await res.json()
      tokens.set(d.accessToken, d.refreshToken)
      return true
    })
    .catch(() => false)
    .finally(() => { refreshing = null })
  return refreshing
}

/** A list the server may have cut off: the rows, and how many matched in all. */
export interface Listed<T> { rows: T[]; total: number }

/** Like api(), for lists with a size limit. `total` is more than rows.length when some matches are not shown. */
export async function apiList<T = unknown>(path: string, retry = true): Promise<Listed<T>> {
  const res = await fetch(`${BASE}/api${path}`, { headers: { 'content-type': 'application/json', ...(tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}) } })
  if (res.status === 401 && retry && (await refreshTokens())) return apiList<T>(path, false)
  if (!res.ok) {
    let msg = res.statusText
    try { const d = await res.json(); msg = Array.isArray(d.message) ? d.message.join(', ') : d.message ?? msg } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, msg)
  }
  const rows = (await res.json()) as T[]
  const total = Number(res.headers.get('x-total-count'))
  return { rows, total: Number.isFinite(total) && total >= rows.length && res.headers.has('x-total-count') ? total : rows.length }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (res.status === 401 && retry && (await refreshTokens())) return api<T>(path, init, false)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const d = await res.json()
      msg = Array.isArray(d.message) ? d.message.join(', ') : d.message ?? msg
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

/** Upload one file as multipart form data (the browser sets the boundary, so no content-type header here). */
export async function uploadFile<T = unknown>(path: string, file: File, title?: string, retry = true, method = 'POST'): Promise<T> {
  const body = new FormData()
  if (title) body.append('title', title) // fields go before the file so the server has them when it reads the file
  body.append('file', file)
  const res = await fetch(`${BASE}/api${path}`, { method, headers: tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}, body })
  if (res.status === 401 && retry && (await refreshTokens())) return uploadFile<T>(path, file, title, false, method)
  if (!res.ok) {
    let msg = res.status === 413 ? 'File is too large (max 10 MB)' : res.statusText
    try { const d = await res.json(); msg = Array.isArray(d.message) ? d.message.join(', ') : d.message ?? msg } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

/** Download a protected file: it needs the auth header, so a plain link would not work. */
export async function downloadFile(path: string, name: string, retry = true): Promise<void> {
  const res = await fetch(`${BASE}/api${path}`, { headers: tokens.access ? { authorization: `Bearer ${tokens.access}` } : {} })
  if (res.status === 401 && retry && (await refreshTokens())) return downloadFile(path, name, false)
  if (!res.ok) {
    let msg = res.status === 404 ? 'File not found' : res.status === 403 ? 'You cannot open this file' : res.statusText
    try { const d = await res.json(); if (d.message) msg = Array.isArray(d.message) ? d.message.join(', ') : d.message } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

/** Fetch a protected file as a Blob (for showing a private image), with the same sign-in refresh as everything else. */
export async function fetchBlob(path: string, retry = true): Promise<Blob> {
  const res = await fetch(`${BASE}/api${path}`, { headers: tokens.access ? { authorization: `Bearer ${tokens.access}` } : {} })
  if (res.status === 401 && retry && (await refreshTokens())) return fetchBlob(path, false)
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  return res.blob()
}
