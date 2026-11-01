import { useEffect, useState } from 'react'

export interface Route {
  path: string[]
  query: URLSearchParams
}

function parse(): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const update = () => setRoute(parse())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export function navigate(path: string): void {
  location.hash = path.startsWith('#') ? path : `#${path}`
}

/** Обратная ссылка только внутри приложения: чужой адрес в адресе страницы не открываем. */
export function localPath(value: string | null): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return undefined
  return value
}
