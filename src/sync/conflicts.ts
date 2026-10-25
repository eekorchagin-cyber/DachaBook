import type { ConsumableUse, DiaryEvent, DocMeta } from '../domain/types'
import type { ConflictRecord, DiaryDatabase } from '../storage/db'
import { contentChecksum, contentOf } from '../storage/repository'
import type { Collection, Tombstone } from './engine'

type Doc = DocMeta & Record<string, unknown>
export type Resolution = 'local' | 'remote' | 'merge'

const union = <T>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])]
const isTombstone = (doc: unknown): doc is Tombstone => !!doc && typeof doc === 'object' && 'purgedAt' in doc

function mergeText(a: string, b: string): string {
  const x = a.trim()
  const y = b.trim()
  if (!x || y.includes(x)) return y
  if (!y || x.includes(y)) return x
  return `${x}\n\n${y}`
}

/** Объединение двух версий записи дневника: тексты, фото, файлы, места и расход складываются, ничего не теряется. */
export function mergeEvents(local: DiaryEvent, remote: DiaryEvent): Record<string, unknown> {
  const consumables: ConsumableUse[] = [...(local.consumables ?? [])]
  for (const use of remote.consumables ?? []) if (!consumables.some((item) => item.consumableId === use.consumableId)) consumables.push(use)
  return {
    ...contentOf(local),
    comment: mergeText(local.comment, remote.comment),
    objectIds: union(local.objectIds, remote.objectIds),
    plantGroupIds: union(local.plantGroupIds, remote.plantGroupIds),
    photoIds: union(local.photoIds, remote.photoIds),
    attachmentIds: union(local.attachmentIds, remote.attachmentIds),
    fileNotes: local.fileNotes || remote.fileNotes ? { ...remote.fileNotes, ...local.fileNotes } : undefined,
    workKind: local.workKind ?? remote.workKind,
    measurement: local.measurement ?? remote.measurement,
    weather: local.weather ?? remote.weather,
    consumables: consumables.length > 0 ? consumables : undefined,
    source: local.source ?? remote.source,
  }
}

export function canMerge(conflict: ConflictRecord): boolean {
  return conflict.collection === 'events' && !isTombstone(conflict.remote)
}

/**
 * Решение конфликта. «Здесь» и «объединить» дают новую редакцию поверх облачной (уйдёт при синхронизации),
 * «из облака» заменяет локальную версию облачной.
 */
export async function resolveConflict(database: DiaryDatabase, conflict: ConflictRecord, choice: Resolution, author: string): Promise<void> {
  const collection = conflict.collection as Collection
  const table = database.table(collection)
  const remote = conflict.remote as Doc | Tombstone
  const local = ((await table.get(conflict.docId)) as Doc | undefined) ?? (conflict.local as Doc)
  const content = choice === 'merge' && canMerge(conflict) ? mergeEvents(local as unknown as DiaryEvent, remote as unknown as DiaryEvent) : contentOf(local)
  const checksum = await contentChecksum(content as never)
  await database.transaction('rw', table, database.syncState, database.conflicts, database.fileContents, async () => {
    if (choice === 'remote') {
      if (isTombstone(remote)) {
        await table.delete(conflict.docId)
        if (collection === 'files') await database.fileContents.delete(conflict.docId)
        await database.syncState.put({ key: conflict.key, revision: remote.revision, remoteMd5: conflict.remoteMd5, purged: true })
      } else {
        await table.put(remote)
        await database.syncState.put({ key: conflict.key, revision: remote.revision, remoteMd5: conflict.remoteMd5 })
      }
    } else {
      const now = new Date().toISOString()
      const deleted = choice === 'merge' && !(remote as Doc).deletedAt ? undefined : local.deletedAt
      const next = {
        ...content,
        id: local.id,
        schemaVersion: local.schemaVersion,
        revision: crypto.randomUUID(),
        baseRevision: remote.revision,
        createdAt: local.createdAt,
        createdBy: local.createdBy,
        updatedAt: now,
        updatedBy: author,
        deletedAt: deleted,
        checksum,
      }
      await table.put(next)
      await database.syncState.put({ key: conflict.key, revision: remote.revision, remoteMd5: conflict.remoteMd5, purged: false })
    }
    await database.conflicts.delete(conflict.id)
  })
}
