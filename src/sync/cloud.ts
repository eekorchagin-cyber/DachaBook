/** Файл в облаке; пути — относительно папки дневника. */
export interface RemoteEntry {
  path: string
  name: string
  /** Время изменения по часам сервера. */
  modified: string
  md5?: string
  size?: number
}

/**
 * Заменяемый адаптер облака (раздел 7 ТЗ): Яндекс Диск, Dropbox, облако в памяти для проверок.
 * Синхронизация работает только через этот интерфейс и не знает, где лежат файлы.
 */
export interface CloudAdapter {
  readonly provider: 'yandex' | 'dropbox' | 'memory'
  ensureFolder(path: string): Promise<void>
  /** Файлы папки, изменённые не раньше курсора (с небольшим запасом); без курсора — все. Возвращает новый курсор. */
  listChanges(folder: string, cursor?: string): Promise<{ entries: RemoteEntry[]; cursor?: string; complete: boolean }>
  list(folder: string): Promise<RemoteEntry[]>
  stat(path: string): Promise<RemoteEntry | null>
  /** null — файла нет. */
  read(path: string): Promise<Blob | null>
  write(path: string, data: Blob): Promise<void>
  remove(path: string): Promise<void>
}

export class CloudError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudError'
  }
}
