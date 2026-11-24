import { useEffect, useState } from 'react'

export interface Route {
  path: string[]
  query: URLSearchParams
}

/** Корни нижнего меню: переход на них сбрасывает вложенную историю «назад». */
const TAB_ROOTS = new Set(['/', '/diary', '/objects', '/library', '/more'])

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

function pageRoot(path: string): string {
  const base = routeKey(path).split('?')[0] || '/'
  return base || '/'
}

function isTabRoot(path: string): boolean {
  return TAB_ROOTS.has(pageRoot(path))
}

function parse(): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  return { path: path.split('/').filter(Boolean), query: new URLSearchParams(query) }
}

let currentHashPath = pathFromHash(typeof location === 'undefined' ? '' : location.hash)
/** Экраны, с которых заходили глубже: стрелка «назад» снимает верхний, а не прыгает туда-сюда. */
let backStack: string[] = []
/** Следующая смена hash уже учтена в goBack/navigate — повторно стек не трогаем. */
let ignoreHashOnce: string | null = null
/**
 * Блокировка ухода с формы с несохранёнными правками.
 * Вернуть true — откатить hash и не обновлять стек; false — обычный переход.
 */
type LeaveBlocker = (nextPath: string) => boolean
let leaveBlocker: LeaveBlocker | null = null

/** Редактор с dirty-формой регистрирует блокировку; перед осознанным уходом снимает её. */
export function setLeaveBlocker(blocker: LeaveBlocker | null): void {
  leaveBlocker = blocker
}

function truncateStackTo(next: string): boolean {
  const key = routeKey(next)
  const index = backStack.findIndex((item) => routeKey(item) === key)
  if (index < 0) return false
  backStack = backStack.slice(0, index)
  return true
}

function rememberHashChange(nextHash?: string): void {
  const next = pathFromHash(nextHash)
  if (ignoreHashOnce !== null && routeKey(next) === routeKey(ignoreHashOnce)) {
    ignoreHashOnce = null
    currentHashPath = next
    return
  }
  if (routeKey(next) === routeKey(currentHashPath)) {
    currentHashPath = next
    return
  }
  // Несохранённая форма: откатываем hash (системная «назад», смена вкладки без leaveGuard и т.п.).
  if (leaveBlocker && leaveBlocker(next)) {
    const restore = currentHashPath
    ignoreHashOnce = restore
    const hash = restore.startsWith('#') ? restore : `#${restore}`
    if (typeof location !== 'undefined' && pathFromHash(location.hash) !== pathFromHash(hash)) {
      location.hash = hash
    }
    return
  }
  // Тот же экран, другие параметры (дата «В этот день», вкладка настроек) — не новый уровень «назад».
  if (pageRoot(next) === pageRoot(currentHashPath)) {
    while (backStack.length > 0 && pageRoot(backStack[backStack.length - 1]!) === pageRoot(next)) {
      backStack.pop()
    }
    if (isTabRoot(next)) backStack = []
    currentHashPath = next
    return
  }
  // Возврат на экран из истории (верх или глубже) — срезаем стек, не пушим текущий обратно.
  if (backStack.length > 0 && routeKey(next) === routeKey(backStack[backStack.length - 1]!)) {
    backStack.pop()
    currentHashPath = next
    return
  }
  if (truncateStackTo(next)) {
    currentHashPath = next
    return
  }
  // Нижнее меню: новая ветка, старая вложенность больше не нужна.
  if (isTabRoot(next)) {
    backStack = []
    currentHashPath = next
    return
  }
  backStack.push(currentHashPath)
  currentHashPath = next
}

/** Верх стека — куда ведёт стрелка «назад», если не задан ?back=. */
export function previousPath(): string | undefined {
  return backStack.at(-1)
}

/** Только для проверок: выставляет текущий экран и историю возврата. */
export function resetNavigationForTests(current = '/', stack: string[] = []): void {
  currentHashPath = current
  backStack = [...stack]
  ignoreHashOnce = null
}

/** Только для проверок: как при смене hash. */
export function rememberNavigationForTests(next: string): void {
  rememberHashChange(next.startsWith('#') ? next : `#${next}`)
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
  ignoreHashOnce = pathFromHash(next)
  location.hash = next
}

/**
 * Стрелка «назад»: снимает уровень со стека и открывает цель.
 * Не через «вперёд» по ссылке — иначе закрытый экран снова попадает в историю и зацикливает возврат.
 */
export function goBack(fallback?: string): void {
  const target = resolveBack(fallback)
  if (!target) return
  if (backStack.length > 0 && routeKey(backStack[backStack.length - 1]!) === routeKey(target)) {
    backStack.pop()
  } else {
    truncateStackTo(target)
  }
  currentHashPath = target
  ignoreHashOnce = target
  const hash = target.startsWith('#') ? target : `#${target}`
  if (pathFromHash(location.hash) === pathFromHash(hash)) {
    ignoreHashOnce = null
    return
  }
  location.hash = hash
}

/** Обратная ссылка только внутри приложения: чужой адрес в адресе страницы не открываем. */
export function localPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return undefined
  return value
}

/**
 * Куда вести стрелку «назад»: явный ?back=, иначе экран из стека переходов, иначе запасной путь меню.
 * Стек при возврате снимается: из уровня 4 на 3, затем на 2, а не снова на 4.
 */
export function resolveBack(fallback?: string, queryBack?: string | null, previous = previousPath(), current = currentHashPath): string | undefined {
  const fromQuery = localPath(queryBack)
  if (fromQuery && routeKey(fromQuery) !== routeKey(current)) return fromQuery
  const fromHistory = localPath(previous)
  if (fromHistory && routeKey(fromHistory) !== routeKey(current)) return fromHistory
  return localPath(fallback ?? null)
}

/** Стрелка «назад» с учётом стека экранов, с которых заходили. */
export function useBackTarget(fallback?: string): string | undefined {
  const route = useRoute()
  return resolveBack(fallback, route.query.get('back'))
}
