import { errorText } from '../lib/format'
import { db, DOC_TABLES } from '../storage/db'
import { buildBackup } from './backup'

/** Минимум File System Access API (Chrome и Edge на компьютере), которого нет в стандартных типах. */
interface BackupFolder {
  name: string
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>
  removeEntry(name: string): Promise<void>
  keys(): AsyncIterable<string>
}

declare global {
  interface Window {
    showDirectoryPicker?: (options: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<BackupFolder>
  }
}

export interface AutoBackupState {
  at?: string
  file?: string
  size?: number
  error?: string
  needsPermission?: boolean
}

const FOLDER_KEY = 'autoBackupFolder'
const STATE_KEY = 'autoBackupState'
const DIRTY_KEY = 'dachabook-autobackup-dirty'
const FILE_PATTERN = /^dachabook-autocopy-\d{4}-\d{2}-\d{2}\.zip$/
const KEEP = 7
const IDLE_MS = 60_000
const MIN_INTERVAL_MS = 10 * 60_000

export function autoBackupSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Одна копия на день: в течение дня файл перезаписывается. */
export function autoBackupFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `dachabook-autocopy-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`
}

/** Старые автокопии сверх последних keep; чужие файлы в папке не трогаются. */
export function filesToPrune(names: string[], keep = KEEP): string[] {
  return names
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(keep)
}

async function folder(): Promise<BackupFolder | undefined> {
  return (await db.settings.get(FOLDER_KEY))?.value as BackupFolder | undefined
}

async function setState(patch: AutoBackupState): Promise<void> {
  const current = ((await db.settings.get(STATE_KEY))?.value as AutoBackupState | undefined) ?? {}
  await db.settings.put({ key: STATE_KEY, value: { ...current, ...patch } })
}

let running: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let lastRunAt = 0
let configured = false

/** Записывает свежую копию в выбранную папку; без разрешения на папку только отмечает, что нужно разрешить. */
export function runAutoBackup(): Promise<void> {
  running ??= (async () => {
    const target = await folder()
    if (!target) return
    if ((await target.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      await setState({ needsPermission: true })
      return
    }
    localStorage.removeItem(DIRTY_KEY)
    try {
      const { blob, manifest } = await buildBackup(db, __APP_VERSION__)
      const name = autoBackupFileName(new Date())
      const writable = await (await target.getFileHandle(name, { create: true })).createWritable()
      await writable.write(blob)
      await writable.close()
      const names: string[] = []
      for await (const entry of target.keys()) names.push(entry)
      for (const old of filesToPrune(names)) await target.removeEntry(old)
      await setState({ at: manifest.exportedAt, file: name, size: blob.size, error: undefined, needsPermission: false })
      await db.settings.put({ key: 'lastBackupAt', value: manifest.exportedAt })
    } catch (caught) {
      localStorage.setItem(DIRTY_KEY, '1')
      await setState({ error: errorText(caught) })
    }
  })().finally(() => {
    running = null
    lastRunAt = Date.now()
  })
  return running
}

function schedule(): void {
  if (!configured) return
  clearTimeout(timer)
  timer = setTimeout(() => void runAutoBackup(), Math.max(IDLE_MS, lastRunAt + MIN_INTERVAL_MS - Date.now()))
}

/** Выбор папки (нужно нажатие пользователя) и сразу первая копия. */
export async function chooseBackupFolder(): Promise<void> {
  if (!window.showDirectoryPicker) throw new Error('Этот браузер не умеет сохранять в папку. Нужен Chrome или Edge на компьютере.')
  let picked: BackupFolder
  try {
    picked = await window.showDirectoryPicker({ id: 'dachabook-autocopy', mode: 'readwrite', startIn: 'documents' })
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    throw caught
  }
  await db.settings.put({ key: FOLDER_KEY, value: picked })
  await db.settings.put({ key: STATE_KEY, value: {} })
  configured = true
  await runAutoBackup()
}

/** После перезапуска браузер может снова спросить разрешение — только по нажатию пользователя. */
export async function grantFolderAccess(): Promise<void> {
  const target = await folder()
  if (!target) return
  if ((await target.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Доступ к папке не разрешён — автокопия приостановлена.')
  await setState({ needsPermission: false })
  await runAutoBackup()
}

export async function disableAutoBackup(): Promise<void> {
  clearTimeout(timer)
  configured = false
  await db.settings.bulkDelete([FOLDER_KEY, STATE_KEY])
}

/** Следит за изменениями данных: копия делается через минуту тишины, не чаще раза в 10 минут. */
export async function startAutoBackup(): Promise<void> {
  if (!autoBackupSupported()) return
  const mark = () => {
    localStorage.setItem(DIRTY_KEY, '1')
    schedule()
  }
  for (const name of [...DOC_TABLES, 'fileContents'] as const) {
    const table = db.table(name)
    table.hook('creating', () => {
      mark()
    })
    table.hook('updating', () => {
      mark()
    })
    table.hook('deleting', () => {
      mark()
    })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && configured && localStorage.getItem(DIRTY_KEY)) {
      clearTimeout(timer)
      void runAutoBackup()
    }
  })

  const target = await folder()
  configured = !!target
  if (!target) return
  const granted = (await target.queryPermission({ mode: 'readwrite' })) === 'granted'
  await setState({ needsPermission: !granted })
  if (granted && localStorage.getItem(DIRTY_KEY)) schedule()
}

export { FOLDER_KEY as AUTO_BACKUP_FOLDER_KEY, STATE_KEY as AUTO_BACKUP_STATE_KEY }
