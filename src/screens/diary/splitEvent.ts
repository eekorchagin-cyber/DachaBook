import { repo } from '../../app/store'
import type { DiaryEvent, ImportSource } from '../../domain/types'
import type { PartDraft } from '../../import/parts'
import { db } from '../../storage/db'

/**
 * Разделяет запись: первая часть остаётся в исходной записи, остальные создаются рядом с той же датой.
 * У импортированной записи все части сохраняют связь с исходной строкой архива («ключ#номер части»).
 */
export async function splitEvent(event: DiaryEvent, parts: PartDraft[]): Promise<string[]> {
  const base = event.source?.fingerprint.split('#')[0]
  const sourceFor = (index: number): ImportSource | undefined =>
    event.source && base ? { ...event.source, fingerprint: `${base}#${index + 1}` } : undefined
  const fields = (part: PartDraft, index: number) => ({
    type: part.type,
    objectIds: part.objectId ? [part.objectId] : [],
    plantGroupIds: part.plantGroupIds,
    workKind: part.type === 'work' ? part.workKind : undefined,
    comment: part.text.trim(),
    photoIds: part.withMedia ? event.photoIds : [],
    attachmentIds: part.withMedia ? event.attachmentIds : [],
    fileNotes: part.withMedia ? event.fileNotes : undefined,
    measurement: undefined,
    source: sourceFor(index),
  })

  await repo.update('events', event.id, fields(parts[0], 0), event.revision)
  const created: string[] = []
  for (const [index, part] of parts.slice(1).entries()) {
    const next = await repo.create('events', { date: event.date, time: event.time, weather: event.weather, ...fields(part, index + 1) })
    created.push(next.id)
  }
  for (const archiveId of event.source?.archiveItemIds ?? []) {
    const item = await db.importArchive.get(archiveId)
    if (item) await repo.update('importArchive', item.id, { createdRecordIds: [...item.createdRecordIds, ...created] }, item.revision)
  }
  return created
}
