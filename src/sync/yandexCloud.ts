import { YandexDisk, YandexDiskError, withRetry, type ResourceMeta, type RetryOptions } from '../cloud/yandexDisk'
import { CloudError, type CloudAdapter, type RemoteEntry } from './cloud'

export const YANDEX_DIARY_ROOT = 'disk:/DachaBook/diary'
const PAGE = 200
/** Сервер загрузки Диска обрывает соединения при частых запросах (и без заголовков CORS — браузер видит это как «нет ответа»). */
const WRITE_RETRY: RetryOptions = { attempts: 5, delaysMs: [3000, 10000, 30000, 60000] }
/** Запас по времени при получении изменений: файлы, записанные почти одновременно с прошлой проверкой, не пропускаются. */
const OVERLAP_MS = 2 * 60 * 1000

export class YandexAuthError extends CloudError {
  constructor() {
    super('Вход в Яндекс устарел или отозван. Войдите в Яндекс снова на экране «Облако».')
    this.name = 'YandexAuthError'
  }
}

/** Адаптер Яндекс Диска: папка дневника, получение изменений по дате на сервере, повторы при сбоях связи. */
export class YandexCloud implements CloudAdapter {
  readonly provider = 'yandex' as const
  readonly parallel = 2
  private disk: YandexDisk
  private root: string
  private folders = new Set<string>()

  constructor(token: string, root = YANDEX_DIARY_ROOT) {
    this.disk = new YandexDisk(token)
    this.root = root
  }

  private full(path: string): string {
    return path ? `${this.root}/${path}` : this.root
  }

  private entry(item: ResourceMeta, folder: string): RemoteEntry {
    return { path: folder ? `${folder}/${item.name}` : item.name, name: item.name, modified: item.modified ?? '', md5: item.md5, size: item.size }
  }

  private async call<T>(action: () => Promise<T>, retry?: RetryOptions): Promise<T> {
    try {
      const [value] = await withRetry(action, retry)
      return value
    } catch (error) {
      if (error instanceof YandexDiskError && error.status === 401) throw new YandexAuthError()
      throw error
    }
  }

  /** Вложенные папки создаются при первой записи в них (ответ 409), здесь — только папка дневника: меньше запросов при каждом запуске. */
  async ensureFolder(path: string, force = false): Promise<void> {
    if (path && !force) return
    const full = this.full(path)
    if (this.folders.has(full)) return
    await this.call(() => this.disk.ensureFolder(full))
    this.folders.add(full)
  }

  async listChanges(folder: string, cursor?: string): Promise<{ entries: RemoteEntry[]; cursor?: string; complete: boolean }> {
    const since = cursor ? Date.parse(cursor) - OVERLAP_MS : -Infinity
    const entries: RemoteEntry[] = []
    for (let offset = 0; ; offset += PAGE) {
      let page: ResourceMeta[]
      try {
        page = await this.call(() => this.disk.listPage(this.full(folder), { sort: '-modified', limit: PAGE, offset }))
      } catch (error) {
        if (error instanceof YandexDiskError && error.status === 404) return { entries: [], cursor, complete: !cursor }
        throw error
      }
      let older = false
      for (const item of page) {
        if (item.type !== 'file') continue
        if (Date.parse(item.modified ?? '') < since) {
          older = true
          break
        }
        entries.push(this.entry(item, folder))
      }
      if (older || page.length < PAGE) break
    }
    const latest = entries.reduce((max, entry) => Math.max(max, Date.parse(entry.modified)), cursor ? Date.parse(cursor) : -Infinity)
    return { entries, cursor: Number.isFinite(latest) ? new Date(latest).toISOString() : cursor, complete: !cursor }
  }

  async list(folder: string): Promise<RemoteEntry[]> {
    return (await this.listChanges(folder)).entries
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    try {
      const meta = await this.call(() => this.disk.meta(this.full(path)))
      const folder = path.split('/').slice(0, -1).join('/')
      return this.entry(meta, folder)
    } catch (error) {
      if (error instanceof YandexDiskError && error.status === 404) return null
      throw error
    }
  }

  async read(path: string): Promise<Blob | null> {
    try {
      return await this.call(() => this.disk.download(this.full(path)))
    } catch (error) {
      if (error instanceof YandexDiskError && error.status === 404) return null
      throw error
    }
  }

  async write(path: string, data: Blob): Promise<void> {
    try {
      await this.call(() => this.disk.upload(this.full(path), data), WRITE_RETRY)
    } catch (error) {
      // Папки ещё нет (409 при получении ссылки загрузки) — создаём и повторяем.
      if (!(error instanceof YandexDiskError && error.status === 409)) throw error
      await this.ensureFolder(path.split('/').slice(0, -1).join('/'), true)
      await this.call(() => this.disk.upload(this.full(path), data), WRITE_RETRY)
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.call(() => this.disk.remove(this.full(path)))
    } catch (error) {
      if (!(error instanceof YandexDiskError && error.status === 404)) throw error
    }
  }
}
