import type { DiaryDatabase } from '../../storage/db'
import type { Repository } from '../../storage/repository'
import { createSnapshot } from '../../storage/snapshots'
import type { FileAdapter } from '../execute'
import { readZipEntry, type DayOnePackage } from './archive'
import { dayOneDrafts, dayOneFingerprint, type DayOneDraftOptions } from './journal'

export interface DayOneImportResult {
  snapshotId: string
  events: number
  skipped: number
  files: number
  missing: number
  errors: string[]
}

export interface DayOneImportProgress {
  phase: 'files' | 'events'
  done: number
  total: number
}

/** Записывает журнал Day One. Уже перенесённые записи (по uuid) не дублируются и их файлы не копируются снова. */
export async function importDayOne(
  pack: DayOnePackage,
  fileName: string,
  options: DayOneDraftOptions,
  context: {
    blob: Blob
    repo: Repository
    database: DiaryDatabase
    files: FileAdapter
    onProgress?: (progress: DayOneImportProgress) => void
  },
): Promise<DayOneImportResult> {
  const { drafts } = dayOneDrafts(pack.entries, options)
  const existing = new Set<string>()
  for (const event of await context.database.events.toArray()) {
    if (event.source?.app === 'dayone' && event.source.fingerprint) existing.add(event.source.fingerprint)
  }
  const fresh = drafts.filter((draft) => !existing.has(dayOneFingerprint(draft.uuid)))
  const snapshotId = await createSnapshot(context.database, 'Перед импортом из Day One')
  const stored = new Map<string, { id: string; role: 'photo' | 'attachment' }>()
  const errors: string[] = []
  const wanted = new Set<string>()
  for (const draft of fresh) for (const media of draft.media) wanted.add(media.md5)

  let events = 0
  let filesDone = 0
  for (const draft of fresh) {
    const photoIds: string[] = []
    const attachmentIds: string[] = []
    for (const media of draft.media) {
      let file = stored.get(media.md5)
      if (!file) {
        filesDone++
        context.onProgress?.({ phase: 'files', done: filesDone, total: wanted.size })
        const saved = await saveMedia(pack, context.blob, context.files, media, errors)
        if (!saved) continue
        file = saved
        stored.set(media.md5, saved)
      }
      const ids = file.role === 'photo' ? photoIds : attachmentIds
      if (!ids.includes(file.id)) ids.push(file.id)
    }
    await context.repo.create('events', {
      type: 'observation',
      date: draft.date,
      time: draft.time,
      objectIds: [],
      plantGroupIds: [],
      comment: draft.comment,
      photoIds,
      attachmentIds,
      weather: draft.weather,
      source: { app: 'dayone', archiveItemIds: [], files: [fileName], fingerprint: dayOneFingerprint(draft.uuid) },
    })
    events++
    if (wanted.size === 0) context.onProgress?.({ phase: 'events', done: events, total: fresh.length })
  }

  return { snapshotId, events, skipped: drafts.length - fresh.length, files: stored.size, missing: wanted.size - stored.size, errors }
}

async function saveMedia(
  pack: DayOnePackage,
  source: Blob,
  files: FileAdapter,
  media: { md5: string; role: 'photo' | 'attachment'; fileName: string; mime: string },
  errors: string[],
): Promise<{ id: string; role: 'photo' | 'attachment' } | undefined> {
  const entry = pack.files.get(media.md5)
  if (!entry) {
    errors.push(`В архиве нет файла ${media.fileName}`)
    return undefined
  }
  try {
    const bytes = await readZipEntry(source, entry)
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: media.mime })
    let role = media.role
    try {
      const id = role === 'photo' ? await files.photo(blob, media.fileName) : await files.attachment(blob, media.fileName)
      return { id, role }
    } catch {
      return { id: await files.attachment(blob, media.fileName), role: 'attachment' }
    }
  } catch (error) {
    errors.push(`${media.fileName}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
