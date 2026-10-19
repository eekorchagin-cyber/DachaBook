// Посредник скачивания для DachaBook: сервер скачивания Яндекс Диска не отдаёт заголовки CORS,
// поэтому браузер не может прочитать файл напрямую. Функция получает готовую подписанную ссылку
// скачивания (токен Яндекса через неё не проходит) и передаёт файл потоком.
// Публикация: Supabase → Edge Functions → имя yandex-download, проверка JWT выключена.

const ALLOWED_ORIGINS = new Set([
  'https://eekorchagin-cyber.github.io',
  'http://localhost:5174',
  'http://localhost:4173',
])

const ALLOWED_HOSTS = [/^downloader\.disk\.yandex\.(ru|net)$/, /\.disk\.yandex\.(ru|net)$/, /\.storage\.yandex\.net$/]

const MAX_REDIRECTS = 5

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    Vary: 'Origin',
  }
}

function isAllowedTarget(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname))
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin') ?? ''
  if (!ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed', { status: 403 })
  const cors = corsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '86400' } })
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors })

  let target: URL
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '')
  } catch {
    return new Response('Missing or invalid url', { status: 400, headers: cors })
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedTarget(target)) return new Response('Host not allowed', { status: 400, headers: cors })
    const upstream = await fetch(target, { redirect: 'manual' })
    const location = upstream.headers.get('Location')
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      await upstream.body?.cancel()
      target = new URL(location, target)
      continue
    }
    const headers = new Headers(cors)
    for (const name of ['Content-Type', 'Content-Length']) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('Cache-Control', 'no-store')
    return new Response(upstream.body, { status: upstream.status, headers })
  }
  return new Response('Too many redirects', { status: 502, headers: cors })
})
