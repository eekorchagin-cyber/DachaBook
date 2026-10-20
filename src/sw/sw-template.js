/* Шаблон: версия и список файлов подставляются при сборке (vite.config.ts). */
const VERSION = '__VERSION__'
const CACHE = `dachabook-${VERSION}`
const FILES = "__FILES__"

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith('dachabook-') && key !== CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: VERSION })
})

// GitHub Pages отвечает с «Vary: Accept-Encoding»: без ignoreVary Safari может не найти копию страницы в кэше.
const MATCH = { ignoreSearch: true, ignoreVary: true }

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/version.json')) return

  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./', MATCH).then((cached) => cached ?? fetch(request)))
    return
  }

  event.respondWith(caches.match(request, MATCH).then((cached) => cached ?? fetch(request)))
})
