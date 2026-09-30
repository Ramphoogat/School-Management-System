/* Service worker: makes the app installable and keeps the shell available offline.
   It never caches API calls (they are on another origin and carry personal data). */
const VERSION = 'v1'
const SHELL = `school-shell-${VERSION}`
const ASSETS = `school-assets-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Page loads: network first so users always get the latest app, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return res }).catch(() => caches.match('/')),
    )
    return
  }

  // Hashed build files never change, so cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); return res })),
    )
  }
})
