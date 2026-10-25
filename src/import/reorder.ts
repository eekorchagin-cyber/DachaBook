import type { DiaryEvent } from '../domain/types'
import type { DiaryDatabase } from '../storage/db'
import type { ImportProposal } from './proposal'

const partNumber = (event: DiaryEvent) => Number(event.source?.fingerprint.split('#')[1] ?? 0)

/**
 * Восстанавливает порядок уже импортированных записей по исходным файлам: время внесения расставляется
 * в порядке строк таблиц, как при новом импорте. Нужно для записей, импортированных одной миллисекундой.
 * Меняется только служебное время внесения — содержимое, ревизии и контрольные суммы не трогаются.
 */
export async function reorderImported(database: DiaryDatabase, proposal: ImportProposal): Promise<number> {
  const byKey = new Map<string, DiaryEvent[]>()
  for (const event of await database.events.toArray()) {
    if (event.source?.app !== 'evernote') continue
    const key = event.source.fingerprint.split('#')[0]
    byKey.set(key, [...(byKey.get(key) ?? []), event])
  }
  const ordered: DiaryEvent[] = []
  const seen = new Set<string>()
  for (const candidate of proposal.events) {
    if (seen.has(candidate.key)) continue
    seen.add(candidate.key)
    const group = byKey.get(candidate.key)
    if (group) ordered.push(...group.sort((a, b) => partNumber(a) - partNumber(b) || a.createdAt.localeCompare(b.createdAt)))
  }
  if (ordered.length === 0) return 0
  const start = Math.min(...ordered.map((event) => Date.parse(event.createdAt)))
  await database.transaction('rw', database.events, async () => {
    for (const [index, event] of ordered.entries()) await database.events.update(event.id, { createdAt: new Date(start + index).toISOString() })
  })
  return ordered.length
}
