/* Шаблон: версия и список файлов подставляются при сборке (vite.config.ts). */
const VERSION = '__VERSION__'
const CACHE = `dachabook-${VERSION}`
const FILES = "__FILES__"

// GitHub Pages отвечает с «Vary: Accept-Encoding»: без ignoreVary Safari может не найти копию страницы в кэше.
const MATCH = { ignoreSearch: true, ignoreVary: true }

// Новая версия не перехватывает открытую страницу сама (skipWaiting только по команде):
// иначе страница старой версии запросит свои скрипты у новой и получит пустой экран.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
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
  if (event.data === 'skip-waiting') self.skipWaiting()
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: VERSION })
})

/** Сначала своя версия, затем любая сохранённая (страница могла открыться из прошлой), затем сеть. */
async function cached(request) {
  const own = await (await caches.open(CACHE)).match(request, MATCH)
  return own ?? (await caches.match(request, MATCH))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/version.json')) return

  if (request.mode === 'navigate') {
    event.respondWith(cached('./').then((response) => response ?? fetch(request)))
    return
  }

  event.respondWith(cached(request).then((response) => response ?? fetch(request)))
})
