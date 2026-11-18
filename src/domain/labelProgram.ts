const BLOCKED = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:'])

/**
 * Адрес, по которому браузер может открыть программу печати меток.
 * Подходит страница сайта и адрес вида name://. Пустая строка и опасные схемы — null.
 */
export function labelProgramTarget(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (BLOCKED.has(url.protocol)) return null
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname.includes('.') ? url.href : null
  return url.href
}

/** Ссылка на экран приложения: маршрут живёт в части после #. */
export function pageLink(path: string, href = location.href): string {
  const url = new URL(href)
  const route = path.startsWith('#') ? path.slice(1) : path
  url.hash = route.startsWith('/') ? route : `/${route}`
  return url.href
}
