import { repo } from '../../app/store'
import type { DiaryEvent, DocInput, ImportSource } from '../../domain/types'
import type { PartDraft } from '../../import/parts'
import { db } from '../../storage/db'

function partFields(
  part: PartDraft,
  media: Pick<DiaryEvent, 'photoIds' | 'attachmentIds' | 'fileNotes'>,
  source?: ImportSource,
): Pick<DocInput<DiaryEvent>, 'type' | 'objectIds' | 'plantGroupIds' | 'workKind' | 'comment' | 'photoIds' | 'attachmentIds' | 'fileNotes' | 'measurement' | 'source'> {
  return {
    type: part.type,
    objectIds: part.objectId ? [part.objectId] : [],
    plantGroupIds: part.plantGroupIds,
    workKind: part.type === 'work' ? part.workKind : undefined,
    comment: part.text.trim(),
    photoIds: part.withMedia ? media.photoIds : [],
    attachmentIds: part.withMedia ? media.attachmentIds : [],
    fileNotes: part.withMedia ? media.fileNotes : undefined,
    // Измерения из текста не извлекаем — поля остаются пустыми, их дозаполняют вручную.
    measurement: part.type === 'measurement' ? {} : undefined,
    source,
  }
}

/**
 * Разделяет запись: первая часть остаётся в исходной записи, остальные создаются рядом с той же датой.
 * У импортированной записи все части сохраняют связь с исходной строкой архива («ключ#номер части»).
 */
export async function splitEvent(event: DiaryEvent, parts: PartDraft[]): Promise<string[]> {
  const base = event.source?.fingerprint.split('#')[0]
  const sourceFor = (index: number): ImportSource | undefined =>
    event.source && base ? { ...event.source, fingerprint: `${base}#${index + 1}` } : undefined
  const media = { photoIds: event.photoIds, attachmentIds: event.attachmentIds, fileNotes: event.fileNotes }

  await repo.update('events', event.id, partFields(parts[0], media, sourceFor(0)), event.revision)
  const created: string[] = []
  for (const [index, part] of parts.slice(1).entries()) {
    const next = await repo.create('events', {
      date: event.date,
      time: event.time,
      weather: event.weather,
      ...partFields(part, media, sourceFor(index + 1)),
    })
    created.push(next.id)
  }
  for (const archiveId of event.source?.archiveItemIds ?? []) {
    const item = await db.importArchive.get(archiveId)
    if (item) await repo.update('importArchive', item.id, { createdRecordIds: [...item.createdRecordIds, ...created] }, item.revision)
  }
  return created
}

/** Новая запись ещё не сохранена: все части создаются как отдельные записи дневника. */
export async function createSplitEvents(
  draft: {
    date: string
    time?: string
    photoIds: string[]
    attachmentIds: string[]
    fileNotes?: DiaryEvent['fileNotes']
  },
  parts: PartDraft[],
): Promise<string[]> {
  const media = { photoIds: draft.photoIds, attachmentIds: draft.attachmentIds, fileNotes: draft.fileNotes }
  const ids: string[] = []
  for (const part of parts) {
    const next = await repo.create('events', { date: draft.date, time: draft.time, ...partFields(part, media) })
    ids.push(next.id)
  }
  return ids
}
