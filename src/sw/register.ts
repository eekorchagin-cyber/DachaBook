import { useSyncExternalStore } from 'react'

export type SwState =
  | { kind: 'unsupported' }
  | { kind: 'dev' }
  | { kind: 'registering' }
  | { kind: 'ready'; controlled: boolean }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }

let state: SwState = { kind: 'registering' }
const listeners = new Set<() => void>()

function setState(next: SwState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Регистрация SW не блокирует приложение: на VPN она может зависнуть, это фиксируется как timeout. */
export function registerServiceWorker(timeoutMs = 15_000): void {
  if (!('serviceWorker' in navigator)) return setState({ kind: 'unsupported' })
  if (!import.meta.env.PROD) return setState({ kind: 'dev' })
  const timer = setTimeout(() => {
    if (state.kind === 'registering') setState({ kind: 'timeout' })
  }, timeoutMs)
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => setState({ kind: 'ready', controlled: !!navigator.serviceWorker.controller }))
    .catch((error: unknown) => setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) }))
    .finally(() => clearTimeout(timer))
}

export function useServiceWorkerState(): SwState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** Проверяет version.json; если вышла новая версия — обновляет офлайн-кэш и перезапускает страницу. */
export async function updateApp(): Promise<'latest' | 'reloading'> {
  const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Не удалось проверить версию: ${response.status}`)
  const { version } = (await response.json()) as { version: string }
  if (version === __APP_VERSION__) return 'latest'
  const registration = await navigator.serviceWorker?.getRegistration()
  if (registration) {
    await registration.update()
    const worker = registration.waiting ?? (await installedWorker(registration))
    if (worker) {
      const switched = new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
        setTimeout(resolve, 10_000)
      })
      worker.postMessage('skip-waiting')
      await switched
    }
  }
  location.reload()
  return 'reloading'
}

/** Ждёт, пока скачанная новая версия закончит установку (до 30 секунд). */
function installedWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const worker = registration.installing
  if (!worker) return Promise.resolve(registration.waiting)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(registration.waiting), 30_000)
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'redundant') {
        clearTimeout(timer)
        resolve(registration.waiting)
      }
    })
  })
}

export async function cachedFileCount(): Promise<number> {
  if (!('caches' in window)) return 0
  let count = 0
  for (const key of await caches.keys()) {
    if (key.startsWith('dachabook-')) count += (await (await caches.open(key)).keys()).length
  }
  return count
}
