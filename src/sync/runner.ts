import { useSyncExternalStore } from 'react'
import { getSetting } from '../app/store'
import { forgetToken, getToken } from '../cloud/yandexAuth'
import type { StoredFile } from '../domain/types'
import { errorText, formatBytes, isIdbTransient } from '../lib/format'
import { onLocalChange } from '../storage/changes'
import { db } from '../storage/db'
import { reopenDatabase } from '../storage/idb'
import type { CloudAdapter } from './cloud'
import { fetchOriginal, forgetSync, pendingCount, readSyncMeta, synchronize, type SyncOptions, type SyncResult } from './engine'
import { stageHeadline, withStageTime } from './eta'
import { YandexAuthError, YandexCloud } from './yandexCloud'

export interface SyncStatus {
  connected: boolean
  running: boolean
  progress?: string
  /** Подробности текущего файла. На главном экране скрыты, пока строку не нажмут. */
  detail?: string
  /** Файл, который передаётся прямо сейчас. */
  fileName?: string
  /** Размер этого файла, уже в виде «4.2 МБ». */
  fileSize?: string
  /** Сколько файлов пропущено вручную и не передаётся. */
  skippedFiles: number
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

let status: SyncStatus = { connected: false, running: false, pending: 0, conflicts: 0, skippedFiles: 0 }
const listeners = new Set<() => void>()
let cloud: { token: string; adapter: CloudAdapter } | null = null
let changeTimer: ReturnType<typeof setTimeout> | undefined
let rerun = false
let lastRunAt = 0
let failures = 0
const inflight = new Map<string, { fileName: string; fileSize: string; controller: AbortController }>()
const skippedNow = new Set<string>()
let stageHead: string | undefined
let stageEndsAt: number | null | undefined
let stageTimer: ReturnType<typeof setInterval> | undefined
let wakeLock: WakeLockSentinel | undefined
let waking = false

/** Пока страница на экране, не даём ему погаснуть: iPhone останавливает передачу вместе с гаснущим экраном. */
async function holdScreen(): Promise<void> {
  if (!('wakeLock' in navigator) || wakeLock || waking) return
  waking = true
  try {
    const sentinel = await navigator.wakeLock.request('screen')
    wakeLock = sentinel
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) wakeLock = undefined
    })
  } catch {
    // Страница уже не на экране или система не разрешила держать его включённым.
  } finally {
    waking = false
  }
}

let syncPaused = false
let syncPause: Promise<void> | undefined
let releaseSyncPause: (() => void) | undefined

/** Остановить текущую передачу, чтобы проверка обновления могла скачать новую версию. */
export function pauseSyncTransfers(): void {
  if (syncPaused) return
  syncPaused = true
  syncPause = new Promise((resolve) => {
    releaseSyncPause = resolve
  })
  for (const item of inflight.values()) item.controller.abort()
}

/** Продолжить передачу после проверки, если страница не перезагружается. */
export function resumeSyncTransfers(): void {
  if (!syncPaused) return
  syncPaused = false
  releaseSyncPause?.()
  releaseSyncPause = undefined
  syncPause = undefined
}

function releaseScreen(): void {
  const current = wakeLock
  wakeLock = undefined
  void current?.release().catch(() => undefined)
}

function stopStageClock(): void {
  stageHead = undefined
  stageEndsAt = undefined
  clearInterval(stageTimer)
  stageTimer = undefined
}

/** Срок этапа фото и файлов обновляется, пока копируется текущий файл, а не только когда файл закончился. */
function stageProgress(now = Date.now()): string | undefined {
  if (!stageHead || stageEndsAt === undefined) return undefined
  return withStageTime(stageHead, stageEndsAt, now)
}

function rememberStage(text: string, endsAt: number | null | undefined): void {
  if (endsAt === undefined) {
    stopStageClock()
    return
  }
  stageHead = stageHeadline(text)
  stageEndsAt = endsAt
  if (!stageTimer) {
    stageTimer = setInterval(() => {
      const progress = stageProgress()
      if (progress) set({ progress })
    }, 30_000)
  }
}
/** Повтор после сбоя: через 1, 2, 5, затем каждые 10 минут. */
const RETRY_MS = [60_000, 120_000, 300_000, 600_000]

function shownFile(): { fileName?: string; fileSize?: string } {
  const item = inflight.values().next().value
  return { fileName: item?.fileName, fileSize: item?.fileSize }
}

function set(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const listener of listeners) listener()
}

/** Пропустить файл, на котором синхронизация стоит сейчас. Он остаётся в дневнике и не передаётся, пока его не вернут в очередь. */
export function skipCurrentSyncFile(): void {
  const named = [...inflight.entries()].find(([, item]) => item.fileName === status.fileName)
  const oldest = named ?? inflight.entries().next().value
  if (!oldest) return
  const [id, item] = oldest
  skippedNow.add(id)
  item.controller.abort()
  void db.syncState.get(`blob/${id}`).then((state) => db.syncState.put({ ...state, key: `blob/${id}`, fileSkippedAt: new Date().toISOString() }))
}

/** Снова передавать файлы, пропущенные вручную. */
export async function retrySkippedFiles(): Promise<void> {
  const rows = await db.syncState.filter((item) => !!item.fileSkippedAt).toArray()
  skippedNow.clear()
  await Promise.all(
    rows.map((row) => {
      const next = { ...row }
      delete next.fileSkippedAt
      return db.syncState.put(next)
    }),
  )
  await syncNow()
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
  set({
    pending: await pendingCount(db),
    conflicts: await db.conflicts.count(),
    skippedFiles: await db.syncState.filter((item) => !!item.fileSkippedAt).count(),
    lastSuccessAt: meta?.lastSuccessAt,
    connected: !!(await connectedProvider()),
  })
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
  set({ running: true, progress: 'Синхронизация…', detail: undefined, fileName: undefined, fileSize: undefined, error: undefined, offline: false, needsLogin: false })
  void holdScreen()
  let result: SyncResult | undefined
  try {
    const options = {
      appVersion: __APP_VERSION__,
      author: (await getSetting('authorName')) || 'Без имени',
      ...extra,
      onProgress: (progress: string, detail?: string, endsAt?: number | null) => {
        rememberStage(progress, endsAt)
        set({
          progress: stageProgress() ?? progress,
          detail,
          ...(detail && /сейчас «/i.test(detail) ? shownFile() : { fileName: undefined, fileSize: undefined }),
        })
      },
      onFile: (file: StoredFile, controller: AbortController) => {
        inflight.set(file.id, { fileName: file.fileName, fileSize: formatBytes(file.size), controller })
        set(shownFile())
      },
      onFileDone: (id: string) => {
        inflight.delete(id)
        set(shownFile())
      },
      isFileSkipped: (id: string) => skippedNow.has(id),
      isPaused: () => syncPaused,
      waitIfPaused: () => syncPause ?? Promise.resolve(),
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
    inflight.clear()
    stopStageClock()
    releaseScreen()
    set({ running: false, progress: undefined, detail: undefined, fileName: undefined, fileSize: undefined })
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
  set({ connected: false, error: undefined, needsLogin: false, lastResult: undefined, skippedFiles: 0 })
  await refreshCounts()
}

const requested = new Set<string>()

/** Оригинал фото или файла, которого нет на устройстве: скачать из облака. Повтор — если скачать не удалось. */
export async function requestOriginal(id: string): Promise<void> {
  if (requested.has(id)) return
  requested.add(id)
  try {
    const adapter = await currentCloud()
    const file = (await db.files.get(id)) as StoredFile | undefined
    if (!adapter || !file) return
    await fetchOriginal(db, adapter, file)
  } catch {
    // Повтор при следующем открытии.
  } finally {
    if (!(await db.fileContents.get(id))?.original) requested.delete(id)
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
    if (!status.connected || document.visibilityState !== 'visible') return
    if (status.running) void holdScreen()
    else if (Date.now() - lastRunAt > RESUME_GAP_MS) void syncNow()
  })
  // iPhone отклоняет просьбу не гасить экран, если она пришла не от касания.
  window.addEventListener('pointerdown', () => {
    if (status.running) void holdScreen()
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
