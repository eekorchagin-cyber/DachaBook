import { useSyncExternalStore } from 'react'
import { getSetting } from '../app/store'
import { forgetToken, getToken } from '../cloud/yandexAuth'
import type { StoredFile } from '../domain/types'
import { errorText, isIdbTransient } from '../lib/format'
import { onLocalChange } from '../storage/changes'
import { db } from '../storage/db'
import { reopenDatabase } from '../storage/idb'
import type { CloudAdapter } from './cloud'
import { fetchOriginal, forgetSync, pendingCount, readSyncMeta, synchronize, type SyncOptions, type SyncResult } from './engine'
import { YandexAuthError, YandexCloud } from './yandexCloud'

export interface SyncStatus {
  connected: boolean
  running: boolean
  progress?: string
  lastSuccessAt?: string
  error?: string
  /** Вход в Яндекс устарел: нужно войти снова. */
  needsLogin?: boolean
  offline?: boolean
  pending: number
  conflicts: number
  lastResult?: SyncResult
}

const PROVIDER_KEY = 'syncProvider'
const CHANGE_DELAY_MS = 20_000
const PERIOD_MS = 5 * 60_000
const RESUME_GAP_MS = 60_000

let status: SyncStatus = { connected: false, running: false, pending: 0, conflicts: 0 }
const listeners = new Set<() => void>()
let cloud: { token: string; adapter: CloudAdapter } | null = null
let changeTimer: ReturnType<typeof setTimeout> | undefined
let rerun = false
let lastRunAt = 0
let failures = 0
/** Повтор после сбоя: через 1, 2, 5, затем каждые 10 минут. */
const RETRY_MS = [60_000, 120_000, 300_000, 600_000]

function set(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const listener of listeners) listener()
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
  )
}

export async function connectedProvider(): Promise<'yandex' | null> {
  return ((await db.settings.get(PROVIDER_KEY))?.value as 'yandex' | undefined) ?? null
}

/** Адаптер облака, если оно подключено и вход действителен. */
export async function currentCloud(): Promise<CloudAdapter | null> {
  if ((await connectedProvider()) !== 'yandex') return null
  const token = getToken()
  if (!token) return null
  if (cloud?.token !== token.accessToken) cloud = { token: token.accessToken, adapter: new YandexCloud(token.accessToken) }
  return cloud.adapter
}

async function refreshCounts(): Promise<void> {
  const meta = await readSyncMeta(db)
  set({ pending: await pendingCount(db), conflicts: await db.conflicts.count(), lastSuccessAt: meta?.lastSuccessAt, connected: !!(await connectedProvider()) })
}

/** Синхронизация сейчас; если уже идёт — повторится сразу после неё. */
export async function syncNow(extra: Pick<SyncOptions, 'firstConnect'> = {}): Promise<SyncResult | undefined> {
  if (status.running) {
    rerun = true
    return undefined
  }
  const adapter = await currentCloud()
  if (!adapter) {
    const provider = await connectedProvider()
    set({ connected: !!provider, needsLogin: !!provider && !getToken() })
    return undefined
  }
  if (!navigator.onLine) {
    set({ offline: true })
    return undefined
  }
  clearTimeout(changeTimer)
  lastRunAt = Date.now()
  set({ running: true, progress: 'Синхронизация…', error: undefined, offline: false, needsLogin: false })
  let result: SyncResult | undefined
  try {
    const options = {
      appVersion: __APP_VERSION__,
      author: (await getSetting('authorName')) || 'Без имени',
      ...extra,
      onProgress: (progress: string) => set({ progress }),
    }
    try {
      result = await synchronize(db, adapter, options)
    } catch (caught) {
      if (!isIdbTransient(caught)) throw caught
      await reopenDatabase(db)
      result = await synchronize(db, adapter, options)
    }
    const error =
      result.failed > 0
        ? `не передано ${result.failed} (будет повтор): ${result.errors[0] ?? 'ошибка связи'}`
        : result.errors.length > 0
          ? result.errors.join('; ')
          : undefined
    set({ lastResult: result, error })
  } catch (caught) {
    if (caught instanceof YandexAuthError) set({ needsLogin: true, error: caught.message })
    else set({ error: errorText(caught), offline: !navigator.onLine })
  } finally {
    set({ running: false, progress: undefined })
    await refreshCounts()
  }
  if (rerun) {
    rerun = false
    void syncNow()
  } else if (status.error && !status.needsLogin) {
    // Сбой связи или сервера: повторить самим, чем дальше — тем реже; при частичном успехе — через минуту.
    const progressed = !!result && result.pushed + result.pulled + result.uploadedFiles > 0
    failures = progressed ? 0 : failures + 1
    clearTimeout(changeTimer)
    changeTimer = setTimeout(() => void syncNow(), RETRY_MS[Math.min(Math.max(failures - 1, 0), RETRY_MS.length - 1)])
  } else {
    failures = 0
    if (status.pending > 0) scheduleSoon()
  }
  return result
}

function scheduleSoon(): void {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void syncNow(), CHANGE_DELAY_MS)
}

export async function enableSync(provider: 'yandex', firstConnect?: SyncOptions['firstConnect']): Promise<SyncResult | undefined> {
  await db.settings.put({ key: PROVIDER_KEY, value: provider })
  set({ connected: true })
  return syncNow({ firstConnect })
}

/** Отключение: данные на устройстве остаются; неотправленные изменения уйдут при следующем подключении. */
export async function disableSync(): Promise<void> {
  clearTimeout(changeTimer)
  await db.settings.delete(PROVIDER_KEY)
  await forgetSync(db)
  forgetToken()
  cloud = null
  set({ connected: false, error: undefined, needsLogin: false, lastResult: undefined })
  await refreshCounts()
}

const requested = new Set<string>()

/** Оригинал фото или файла, которого нет на устройстве: скачать из облака (один раз за сеанс на файл). */
export async function requestOriginal(id: string): Promise<void> {
  if (requested.has(id)) return
  requested.add(id)
  const adapter = await currentCloud()
  const file = (await db.files.get(id)) as StoredFile | undefined
  if (!adapter || !file) return
  try {
    await fetchOriginal(db, adapter, file)
  } catch {
    requested.delete(id)
  }
}

/** Запуск при открытии, возврате в приложение, появлении сети, после изменений и раз в 5 минут. */
export async function startSync(): Promise<void> {
  await refreshCounts()
  onLocalChange(() => {
    if (status.connected && !status.running) {
      void refreshCounts()
      scheduleSoon()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (status.connected && document.visibilityState === 'visible' && Date.now() - lastRunAt > RESUME_GAP_MS) void syncNow()
  })
  window.addEventListener('online', () => {
    if (status.connected) void syncNow()
  })
  window.addEventListener('offline', () => set({ offline: true }))
  setInterval(() => {
    if (status.connected && document.visibilityState === 'visible') void syncNow()
  }, PERIOD_MS)
  if (status.connected) setTimeout(() => void syncNow(), 1500)
}

export const syncTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'ещё не было')

/** Строка состояния для главного экрана и экрана «Облако». */
export function syncSummary(status: SyncStatus): { text: string; warning: boolean } {
  if (status.needsLogin) return { text: 'Вход в Яндекс устарел — войдите снова', warning: true }
  if (status.conflicts > 0) return { text: `Конфликты: ${status.conflicts} — нужно выбрать версию`, warning: true }
  if (status.running) return { text: status.progress ?? 'Синхронизация…', warning: false }
  if (status.error) return { text: `Синхронизация не удалась: ${status.error}`, warning: true }
  if (status.offline) return { text: `Нет сети. Ожидает отправки: ${status.pending}`, warning: false }
  if (status.pending > 0) return { text: `Ожидает отправки: ${status.pending}`, warning: false }
  return { text: `Синхронизировано: ${syncTime(status.lastSuccessAt)}`, warning: false }
}
