import SparkMD5 from 'spark-md5'
import type { CloudAdapter, RemoteEntry } from './cloud'

interface StoredEntry {
  data: Blob
  modified: number
  md5: string
}

/** Облако в памяти: для автоматических проверок синхронизации двух устройств. */
export class MemoryCloud implements CloudAdapter {
  readonly provider = 'memory' as const
  files = new Map<string, StoredEntry>()
  writes = 0
  reads = 0
  private clock = 0

  private entry(path: string, stored: StoredEntry): RemoteEntry {
    return { path, name: path.split('/').at(-1) ?? path, modified: new Date(stored.modified).toISOString(), md5: stored.md5, size: stored.data.size }
  }

  async ensureFolder(): Promise<void> {}

  async listChanges(folder: string, cursor?: string): Promise<{ entries: RemoteEntry[]; cursor?: string; complete: boolean }> {
    const since = cursor ? Date.parse(cursor) : -Infinity
    const entries = [...this.files.entries()]
      .filter(([path, stored]) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/') && stored.modified >= since)
      .map(([path, stored]) => this.entry(path, stored))
    const latest = entries.reduce((max, entry) => Math.max(max, Date.parse(entry.modified)), since)
    return { entries, cursor: Number.isFinite(latest) ? new Date(latest).toISOString() : cursor, complete: !cursor }
  }

  async list(folder: string): Promise<RemoteEntry[]> {
    return (await this.listChanges(folder)).entries
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const stored = this.files.get(path)
    return stored ? this.entry(path, stored) : null
  }

  async read(path: string): Promise<Blob | null> {
    this.reads++
    return this.files.get(path)?.data ?? null
  }

  async write(path: string, data: Blob): Promise<void> {
    // Время сервера идёт вперёд, как настоящие часы, и не повторяется.
    this.clock = Math.max(Date.now(), this.clock + 1)
    this.writes++
    this.files.set(path, { data, modified: this.clock, md5: SparkMD5.ArrayBuffer.hash(await data.arrayBuffer()) })
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
}
