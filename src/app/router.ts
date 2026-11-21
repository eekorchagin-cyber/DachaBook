import { useEffect, useState } from 'react'

export interface Route {
  path: string[]
  query: URLSearchParams
}

/** Путь внутри приложения из hash: «/sync», «/diary?text=…». */
export function pathFromHash(hash?: string): string {
  const value = hash ?? (typeof location === 'undefined' ? '' : location.hash)
  const raw = value.replace(/^#/, '')
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** Сравнивает экраны без параметра back: «/sync» и «/sync?back=/» — один и тот же. */
export function routeKey(path: string): string {
  const [base, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.delete('back')
  const rest = params.toString()
  const page = base || '/'
  return rest ? `${page}?${rest}` : page
}

function parse(): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) }
}

let currentHashPath = pathFromHash(typeof location === 'undefined' ? '' : location.hash)
let previousHashPath: string | undefined

function rememberHashChange(nextHash?: string): void {
  const next = pathFromHash(nextHash)
  if (routeKey(next) === routeKey(currentHashPath)) {
    currentHashPath = next
    return
  }
  previousHashPath = currentHashPath
  currentHashPath = next
}

/** Предыдущий экран внутри приложения — куда логично вести стрелку «назад». */
export function previousPath(): string | undefined {
  return previousHashPath
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const update = () => {
      rememberHashChange()
      setRoute(parse())
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export function navigate(path: string): void {
  const next = path.startsWith('#') ? path : `#${path}`
  rememberHashChange(next)
  location.hash = next
}

/** Обратная ссылка только внутри приложения: чужой адрес в адресе страницы не открываем. */
export function localPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return undefined
  return value
}

/**
 * Куда вести стрелку «назад»: явный ?back=, иначе экран, с которого пришли, иначе запасной путь экрана.
 * Так с главной в «Яндекс Диск» возврат — на главную, а из меню облака — в «Облако и резервное копирование».
 */
export function resolveBack(fallback?: string, queryBack?: string | null, previous = previousPath(), current = pathFromHash()): string | undefined {
  const fromQuery = localPath(queryBack)
  if (fromQuery && routeKey(fromQuery) !== routeKey(current)) return fromQuery
  const fromHistory = localPath(previous)
  if (fromHistory && routeKey(fromHistory) !== routeKey(current)) return fromHistory
  return localPath(fallback ?? null)
}

/** Стрелка «назад» с учётом экрана, с которого открыли текущий. */
export function useBackTarget(fallback?: string): string | undefined {
  const route = useRoute()
  // previousPath читается на каждом рендере после hashchange — отдельный state не нужен.
  return resolveBack(fallback, route.query.get('back'))
}
