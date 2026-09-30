import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Newer Node versions define a half-working global localStorage that hides jsdom's, so tests get a plain in-memory one.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} })

afterEach(() => { cleanup(); store.clear() })

// jsdom lacks these browser features, which the command bar's list needs.
class NoopObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: NoopObserver })
Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined })
