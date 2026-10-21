import type { DiaryDatabase } from './db'

const COLLECTIONS = ['objects', 'plantGroups', 'events', 'files', 'references', 'planDrafts', 'importArchive', 'settings'] as const
const KEEP = 5

/** Снимок всех документов перед массовой операцией; хранится последние пять. */
export async function createSnapshot(database: DiaryDatabase, reason: string): Promise<string> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const name of COLLECTIONS) {
    data[name] = await database.table(name).toArray()
    counts[name] = data[name].length
  }
  const id = crypto.randomUUID()
  await database.snapshots.add({ id, createdAt: new Date().toISOString(), reason, counts, data })
  const old = await database.snapshots.orderBy('createdAt').reverse().offset(KEEP).primaryKeys()
  await database.snapshots.bulkDelete(old)
  return id
}
