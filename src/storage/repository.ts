import { sha256Hex } from '../lib/hash'
import { SCHEMA_VERSION, type CollectionName, type Collections, type DocInput, type DocMeta, type MetaKey } from '../domain/types'
import type { DiaryDatabase } from './db'

const META_KEYS: readonly MetaKey[] = [
  'id',
  'schemaVersion',
  'revision',
  'baseRevision',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'checksum',
]

/** JSON с упорядоченными ключами: одинаковое содержимое всегда даёт одинаковую контрольную сумму. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contentOf<T extends DocMeta>(doc: T | DocInput<T>): Record<string, unknown> {
  const content: Record<string, unknown> = { ...(doc as object) }
  for (const key of META_KEYS) delete content[key]
  return content
}

export function contentChecksum<T extends DocMeta>(doc: T | DocInput<T>): Promise<string> {
  return sha256Hex(canonicalJson(contentOf(doc)))
}

export async function verifyChecksum(doc: DocMeta): Promise<boolean> {
  return (await contentChecksum(doc)) === doc.checksum
}

export class ConflictError extends Error {
  current: DocMeta | undefined

  constructor(current: DocMeta | undefined) {
    super(current ? 'Запись изменена в другом месте после открытия' : 'Запись не найдена')
    this.name = 'ConflictError'
    this.current = current
  }
}

type Patch<K extends CollectionName> = Partial<DocInput<Collections[K]>>

/** Единственная точка записи документов: служебные поля, ревизии и контрольные суммы. */
export class Repository {
  private database: DiaryDatabase
  private author: () => string

  constructor(database: DiaryDatabase, author: () => string) {
    this.database = database
    this.author = author
  }

  table<K extends CollectionName>(name: K) {
    return this.database.table<Collections[K], string>(name)
  }

  get<K extends CollectionName>(name: K, id: string): Promise<Collections[K] | undefined> {
    return this.table(name).get(id)
  }

  async create<K extends CollectionName>(name: K, input: DocInput<Collections[K]>): Promise<Collections[K]> {
    const now = new Date().toISOString()
    const author = this.author()
    const doc = {
      ...contentOf(input),
      id: input.id ?? crypto.randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      revision: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: author,
      updatedBy: author,
      checksum: await contentChecksum(input),
    } as unknown as Collections[K]
    await this.database.transaction('rw', this.table(name), async () => {
      if (await this.table(name).get(doc.id)) throw new Error(`Запись ${doc.id} уже существует`)
      await this.table(name).add(doc)
    })
    return doc
  }

  /** Правка проходит, только если запись не менялась с ревизии expectedRevision. */
  async update<K extends CollectionName>(
    name: K,
    id: string,
    patch: Patch<K>,
    expectedRevision: string,
  ): Promise<Collections[K]> {
    const current = await this.get(name, id)
    if (!current || current.revision !== expectedRevision) throw new ConflictError(current)
    const content = { ...contentOf(current), ...contentOf(patch as DocInput<Collections[K]>) }
    const next = {
      ...current,
      ...content,
      revision: crypto.randomUUID(),
      baseRevision: current.revision,
      updatedAt: new Date().toISOString(),
      updatedBy: this.author(),
      checksum: await sha256Hex(canonicalJson(content)),
    } as Collections[K]
    await this.database.transaction('rw', this.table(name), async () => {
      const latest = await this.table(name).get(id)
      if (!latest || latest.revision !== expectedRevision) throw new ConflictError(latest)
      await this.table(name).put(next)
    })
    return next
  }

  /** Перемещение в корзину; запись и связи сохраняются. */
  remove<K extends CollectionName>(name: K, id: string, expectedRevision: string): Promise<Collections[K]> {
    return this.setDeleted(name, id, expectedRevision, new Date().toISOString())
  }

  restore<K extends CollectionName>(name: K, id: string, expectedRevision: string): Promise<Collections[K]> {
    return this.setDeleted(name, id, expectedRevision, undefined)
  }

  private async setDeleted<K extends CollectionName>(
    name: K,
    id: string,
    expectedRevision: string,
    deletedAt: string | undefined,
  ): Promise<Collections[K]> {
    let result: Collections[K] | undefined
    await this.database.transaction('rw', this.table(name), async () => {
      const current = await this.table(name).get(id)
      if (!current || current.revision !== expectedRevision) throw new ConflictError(current)
      result = {
        ...current,
        deletedAt,
        revision: crypto.randomUUID(),
        baseRevision: current.revision,
        updatedAt: new Date().toISOString(),
        updatedBy: this.author(),
      }
      await this.table(name).put(result)
    })
    return result!
  }
}
