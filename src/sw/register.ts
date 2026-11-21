import { useSyncExternalStore } from 'react'
import { pauseSyncTransfers, resumeSyncTransfers } from '../sync/runner'

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
  // updateViaCache: 'none' — иначе Safari на iPhone долго отдаёт старый sw.js из HTTP-кэша.
  navigator.serviceWorker
    .register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((registration) => {
      watchForUpdates(registration)
      return navigator.serviceWorker.ready
    })
    .then(() => setState({ kind: 'ready', controlled: !!navigator.serviceWorker.controller }))
    .catch((error: unknown) => setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) }))
    .finally(() => clearTimeout(timer))
}

let updateReady = false
const updateListeners = new Set<() => void>()

function markUpdateReady(): void {
  if (updateReady || !navigator.serviceWorker.controller) return
  updateReady = true
  for (const listener of updateListeners) listener()
}

/** Новая версия скачивается в фоне и ждёт; приложение показывает полосу «Обновить». */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return
    if (worker.state === 'installed') markUpdateReady()
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') markUpdateReady()
    })
  }
  if (registration.waiting) markUpdateReady()
  // Скачивание могло начаться ещё до подписки на updatefound.
  track(registration.installing)
  registration.addEventListener('updatefound', () => track(registration.installing))

  let lastCheck = Date.now()
  const check = () => {
    if (Date.now() - lastCheck < 60_000) return
    lastCheck = Date.now()
    void registration.update().catch(() => undefined)
  }
  // На Mac окно программы остаётся видимым при переключении окон, поэтому нужен и focus.
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  setInterval(() => {
    lastCheck = 0
    check()
  }, 30 * 60_000)
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      updateListeners.add(listener)
      return () => updateListeners.delete(listener)
    },
    () => updateReady,
  )
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

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** Снимает офлайн-кэш приложения, чтобы следующая загрузка взяла файлы с сайта. */
async function clearAppCaches(): Promise<void> {
  if (!('caches' in window)) return
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => key.startsWith('dachabook-')).map((key) => caches.delete(key)))
}

/**
 * Ищет новый SW после update(): waiting, installing или короткое ожидание updatefound.
 * На iPhone update() иногда завершается без waiting, если sw.js отдал HTTP-кэш.
 */
async function findUpdatedWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.waiting) return registration.waiting
  if (registration.installing) return installedWorker(registration)
  return new Promise((resolve) => {
    const finish = () => resolve(registration.waiting)
    const timer = setTimeout(finish, 12_000)
    registration.addEventListener(
      'updatefound',
      () => {
        void installedWorker(registration).then((worker) => {
          clearTimeout(timer)
          resolve(worker)
        })
      },
      { once: true },
    )
  })
}

/** version.json новее, а SW не обновился — снимаем регистрацию и кэш, страница перезагрузится с сети. */
async function forceNetworkReload(registration: ServiceWorkerRegistration): Promise<void> {
  await clearAppCaches()
  await registration.unregister().catch(() => undefined)
}

/** Проверяет version.json; если вышла новая версия — обновляет офлайн-кэш и перезапускает страницу. Передача файлов на это время останавливается. */
export async function updateApp(): Promise<'latest' | 'reloading'> {
  pauseSyncTransfers()
  let resume = true
  try {
    let response: Response
    try {
      response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new Error('Нет связи, чтобы проверить обновление.')
    }
    if (!response.ok) throw new Error('Не удалось проверить обновление. Проверьте интернет и откройте DachaBook с ярлыка.')
    let version: string | undefined
    try {
      version = ((await response.json()) as { version?: string }).version
    } catch {
      throw new Error('Не удалось прочитать номер версии. Откройте DachaBook с ярлыка и повторите.')
    }
    if (!version) throw new Error('Не удалось прочитать номер версии.')
    if (version === __APP_VERSION__) return 'latest'
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      await withTimeout(registration.update(), 20_000, 'Не удалось скачать обновление. Оставьте программу на экране и повторите.')
      const worker = await findUpdatedWorker(registration)
      if (worker) {
        const switched = new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
          setTimeout(resolve, 10_000)
        })
        worker.postMessage('skip-waiting')
        await switched
      } else {
        // Safari часто не ставит новый SW из кэша — принудительно берём сборку с сайта.
        await forceNetworkReload(registration)
      }
    }
    resume = false
    location.reload()
    return 'reloading'
  } finally {
    if (resume) resumeSyncTransfers()
  }
}

/** Ждёт, пока скачанная новая версия закончит установку (до 60 секунд). */
function installedWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const worker = registration.installing
  if (!worker) return Promise.resolve(registration.waiting)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(registration.waiting), 60_000)
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
