/* Шаблон: версия и список файлов подставляются при сборке (vite.config.ts). */
const VERSION = '0.1.0+20261031-1728'
const CACHE = `dachabook-${VERSION}`
const FILES = ["./","./apple-touch-icon.png","./favicon.png","./icon-192.png","./icon-512.png","./manifest.webmanifest","./assets/index-CBprqDf5.js","./assets/index-DjIk7mBl.css"]

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

/** Фото из системного «Поделиться»: кладём во временный кэш и открываем экран приёма. */
async function handleShare(request) {
  const formData = await request.formData()
  const cache = await caches.open('share-inbox')
  const named = ['photos', 'file', 'media', 'image'].flatMap((name) => formData.getAll(name))
  const files = (named.length > 0 ? named : [...formData.values()]).filter((item) => item instanceof File && item.size > 0)
  let index = (await cache.keys()).length
  for (const file of files) {
    index++
    await cache.put(
      `./inbox/${Date.now()}-${index}-${encodeURIComponent(file.name || 'photo.jpg')}`,
      new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name || 'photo.jpg'),
        },
      }),
    )
  }
  const caption = [formData.get('title'), formData.get('text'), formData.get('url')]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
  if (caption) {
    await cache.put('./inbox/caption', new Response(caption, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
  }
  return Response.redirect(new URL('./#/share', request.url).href, 303)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.method === 'POST' && /\/share\/?$/.test(url.pathname)) {
    event.respondWith(handleShare(request))
    return
  }
  if (request.method !== 'GET') return
  if (url.pathname.endsWith('/version.json')) return

  if (request.mode === 'navigate') {
    event.respondWith(cached('./').then((response) => response ?? fetch(request)))
    return
  }

  event.respondWith(cached(request).then((response) => response ?? fetch(request)))
})
