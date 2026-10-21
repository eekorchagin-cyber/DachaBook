import type { CareObject, DocMeta, ImportArchiveItem, ImportSource, PlanDraftItem } from '../domain/types'
import { sha256Hex } from '../lib/hash'
import type { DiaryDatabase } from '../storage/db'
import type { Repository } from '../storage/repository'
import { createSnapshot } from '../storage/snapshots'
import { enmlToHtml } from './enex/enml'
import type { EnexResource } from './enex/parser'
import type { PartDraft } from './parts'
import type { EventCandidate, ImportProposal, NoteCandidate, SourceRow } from './proposal'
import { suggestObject, textKey } from './suggest'

export interface EventDecision {
  include: boolean
  type: 'work' | 'observation'
  objectId: string
  workKind?: string
  date?: string
  text: string
  /** Строка разделена на несколько записей (две и больше частей). */
  parts?: PartDraft[]
}

export interface PlanPart {
  text: string
  itemType: 'work' | 'observation'
}

export interface ImportDecisions {
  events: Record<string, EventDecision>
  plan: Record<string, boolean>
  planParts: Record<string, PlanPart[]>
  notes: Record<string, 'reference' | 'skip'>
  outside: boolean
}

export interface ExistingIndex {
  eventKeys: Set<string>
  planKeys: Set<string>
  noteKeys: Set<string>
  hasOutside: boolean
}

export const OUTSIDE_KEY = 'evernote-outside-tables'

export function noteKey(candidate: NoteCandidate): string {
  return `note|${candidate.note.title}|${candidate.note.created ?? ''}`
}

/** Что уже есть в базе: повторный импорт не создаёт дубликатов (раздел 3 ТЗ, П-24). */
export async function existingIndex(database: DiaryDatabase): Promise<ExistingIndex> {
  const [events, plan, references] = await Promise.all([database.events.toArray(), database.planDrafts.toArray(), database.references.toArray()])
  const eventKeys = new Set<string>()
  // Разделённая строка хранит ключ «ключ#номер части»; повторный импорт узнаёт её по исходному ключу.
  const base = (fingerprint: string) => fingerprint.split('#')[0]
  for (const event of events) {
    if (event.deletedAt) continue
    if (event.source?.fingerprint) eventKeys.add(base(event.source.fingerprint))
    eventKeys.add(`${event.date}|${textKey(event.comment)}`)
  }
  return {
    eventKeys,
    planKeys: new Set(plan.filter((item) => !item.deletedAt && item.source).map((item) => base(item.source!.fingerprint))),
    noteKeys: new Set(references.filter((item) => !item.deletedAt && item.source).map((item) => item.source!.fingerprint)),
    hasOutside: references.some((item) => !item.deletedAt && item.source?.fingerprint === OUTSIDE_KEY),
  }
}

export function eventExists(candidate: EventCandidate, existing: ExistingIndex): boolean {
  return existing.eventKeys.has(candidate.key) || candidate.variants.some((text) => existing.eventKeys.has(`${candidate.date}|${textKey(text)}`))
}

/** Решения по умолчанию: неподтверждённые даты, «прошлые годы» и уже импортированное не включаются. */
export function defaultDecisions(proposal: ImportProposal, objects: CareObject[], existing: ExistingIndex): ImportDecisions {
  const objectId = (name: string) => objects.find((item) => item.name === name)?.id ?? objects[0]?.id ?? ''
  const events: Record<string, EventDecision> = {}
  for (const candidate of proposal.events) {
    events[candidate.key] = {
      include: !candidate.needsConfirmation && !eventExists(candidate, existing),
      type: candidate.type,
      objectId: objectId(candidate.objectName),
      workKind: candidate.workKind,
      date: candidate.date ?? candidate.suggestion,
      text: candidate.variants[0],
    }
  }
  const plan: Record<string, boolean> = {}
  for (const candidate of proposal.plan) plan[candidate.key] = !candidate.fromPastOnly && !existing.planKeys.has(candidate.key)
  const notes: Record<string, 'reference' | 'skip'> = {}
  for (const candidate of proposal.notes) notes[noteKey(candidate)] = existing.noteKeys.has(noteKey(candidate)) ? 'skip' : 'reference'
  return { events, plan, planParts: {}, notes, outside: proposal.outside.length > 0 && !existing.hasOutside }
}

export interface FileAdapter {
  photo(blob: Blob, fileName: string): Promise<string>
  attachment(blob: Blob, fileName: string): Promise<string>
}

export interface ImportResult {
  snapshotId: string
  events: number
  planItems: number
  references: number
  files: number
  archiveItems: number
  errors: string[]
}

export interface ImportContext {
  repo: Repository
  database: DiaryDatabase
  files: FileAdapter
  objects: CareObject[]
  onProgress?: (done: number, total: number) => void
}

function resourceName(resource: EnexResource): string {
  if (resource.fileName) return resource.fileName
  const extension = resource.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin'
  return `${resource.md5}.${extension}`
}

async function rowFingerprint(source: SourceRow): Promise<string> {
  const { row } = source
  return sha256Hex([source.fileName, source.noteTitle, row.index, row.month, row.week ?? '', row.checkbox, row.rawDate, row.text].join('|'))
}

/** Записывает выбранное в базу; существующие записи не меняются и не удаляются. */
export async function executeImport(proposal: ImportProposal, decisions: ImportDecisions, context: ImportContext): Promise<ImportResult> {
  const { repo, database, files } = context
  const errors: string[] = []
  const snapshotId = await createSnapshot(database, 'Перед импортом из Evernote')
  const objectId = (name: string) => context.objects.find((item) => item.name === name)?.id ?? context.objects[0]?.id ?? ''

  const fileIds = new Map<string, string>()
  let createdFiles = 0
  const fileFor = async (hash: string, asPhoto: boolean): Promise<{ id: string; image: boolean; name: string } | undefined> => {
    const resource = proposal.resources.get(hash)
    if (!resource) return undefined
    const image = resource.mime.startsWith('image/')
    const cacheKey = `${hash}|${asPhoto && image ? 'photo' : 'file'}`
    let id = fileIds.get(cacheKey)
    if (!id) {
      try {
        id = asPhoto && image ? await files.photo(resource.data, resourceName(resource)) : await files.attachment(resource.data, resourceName(resource))
      } catch {
        id = await files.attachment(resource.data, resourceName(resource))
      }
      fileIds.set(cacheKey, id)
      createdFiles++
    }
    return { id, image, name: resourceName(resource) }
  }

  // Архив: каждая строка каждой заметки в исходном виде (раздел 3 ТЗ, «Сохранность исходных данных»).
  const archiveByRow = new Map<SourceRow, string>()
  const createdFor = new Map<string, string[]>()
  const archiveDrafts: (Omit<ImportArchiveItem, keyof DocMeta> & { id: string; existing?: ImportArchiveItem })[] = []
  const existingArchive = new Map((await database.importArchive.toArray()).map((item) => [item.fingerprint, item]))

  for (const source of proposal.rows) {
    const fingerprint = await rowFingerprint(source)
    const existing = existingArchive.get(fingerprint)
    const id = existing?.id ?? crypto.randomUUID()
    archiveByRow.set(source, id)
    archiveDrafts.push({
      id,
      existing,
      sourceFileId: source.fileName,
      sourceFileName: source.fileName,
      noteTitle: source.noteTitle,
      kind: 'row',
      month: source.row.month,
      week: source.row.week,
      text: source.row.text,
      rawDate: source.row.rawDate,
      checkbox: source.row.checkbox,
      fingerprint,
      createdRecordIds: existing?.createdRecordIds ?? [],
    })
  }
  const noteArchive = new Map<string, string>()
  for (const candidate of proposal.notes) {
    const fingerprint = await sha256Hex(`${candidate.fileName}|${noteKey(candidate)}`)
    const existing = existingArchive.get(fingerprint)
    const id = existing?.id ?? crypto.randomUUID()
    noteArchive.set(noteKey(candidate), id)
    archiveDrafts.push({
      id,
      existing,
      sourceFileId: candidate.fileName,
      sourceFileName: candidate.fileName,
      noteTitle: candidate.note.title,
      kind: 'note',
      text: candidate.note.content,
      fingerprint,
      createdRecordIds: existing?.createdRecordIds ?? [],
    })
  }

  const link = (archiveIds: string[], recordId: string) => {
    for (const id of archiveIds) createdFor.set(id, [...(createdFor.get(id) ?? []), recordId])
  }
  const sourceOf = (rows: SourceRow[], fingerprint: string): ImportSource => ({
    app: 'evernote',
    archiveItemIds: rows.map((row) => archiveByRow.get(row)!).filter(Boolean),
    files: [...new Set(rows.map((row) => row.fileName))],
    fingerprint,
  })

  const chosenEvents = proposal.events.filter((candidate) => decisions.events[candidate.key]?.include)
  const chosenPlan = proposal.plan.filter((candidate) => decisions.plan[candidate.key])
  const chosenNotes = proposal.notes.filter((candidate) => decisions.notes[noteKey(candidate)] === 'reference')
  const total = chosenEvents.length + chosenPlan.length + chosenNotes.length + archiveDrafts.length + (decisions.outside ? 1 : 0)
  let done = 0
  const tick = () => context.onProgress?.(++done, total)

  let events = 0
  for (const candidate of chosenEvents) {
    const decision = decisions.events[candidate.key]
    try {
      if (!decision.date) throw new Error('не указана дата')
      const split = decision.parts && decision.parts.length > 1
      const pieces: PartDraft[] = split
        ? decision.parts!
        : [{ text: decision.text, type: decision.type, objectId: decision.objectId, workKind: decision.workKind, plantGroupIds: [], withMedia: true }]
      const photoIds: string[] = []
      const attachmentIds: string[] = []
      for (const hash of candidate.mediaHashes) {
        const file = await fileFor(hash, true)
        if (file) (file.image ? photoIds : attachmentIds).push(file.id)
      }
      for (const [index, piece] of pieces.entries()) {
        const source = sourceOf(candidate.sources, split ? `${candidate.key}#${index + 1}` : candidate.key)
        const event = await repo.create('events', {
          type: piece.type,
          date: decision.date,
          objectIds: piece.objectId ? [piece.objectId] : [],
          plantGroupIds: piece.plantGroupIds,
          workKind: piece.type === 'work' ? piece.workKind : undefined,
          comment: piece.text.trim(),
          photoIds: piece.withMedia ? photoIds : [],
          attachmentIds: piece.withMedia ? attachmentIds : [],
          source,
        })
        link(source.archiveItemIds, event.id)
        events++
      }
    } catch (error) {
      errors.push(`Запись «${candidate.text.slice(0, 60)}»: ${error instanceof Error ? error.message : String(error)}`)
    }
    tick()
  }

  let planItems = 0
  for (const candidate of chosenPlan) {
    try {
      const fileIdsForItem: string[] = []
      for (const hash of candidate.mediaHashes) {
        const file = await fileFor(hash, false)
        if (file) fileIdsForItem.push(file.id)
      }
      const parts = decisions.planParts[candidate.key]
      const split = !!parts && parts.length > 1
      const pieces: PlanPart[] = split ? parts : [{ text: candidate.text, itemType: candidate.itemType }]
      for (const [index, piece] of pieces.entries()) {
        const source = sourceOf(candidate.sources, split ? `${candidate.key}#${index + 1}` : candidate.key)
        const item = await repo.create('planDrafts', {
          itemType: piece.itemType,
          periods: candidate.periods,
          text: piece.text.trim(),
          objectIds: [objectId(suggestObject(piece.text))],
          plantGroupIds: [],
          fileIds: index === 0 ? fileIdsForItem : [],
          seasonsDone: piece.itemType === 'work' ? candidate.seasonsDone : [],
          transferred: false,
          source,
        } satisfies Omit<PlanDraftItem, keyof DocMeta>)
        link(source.archiveItemIds, item.id)
        planItems++
      }
    } catch (error) {
      errors.push(`План «${candidate.text.slice(0, 60)}»: ${error instanceof Error ? error.message : String(error)}`)
    }
    tick()
  }

  let references = 0
  for (const candidate of chosenNotes) {
    try {
      const attachments: string[] = []
      const resolved = new Map<string, { fileId: string; isImage: boolean; fileName: string }>()
      for (const resource of candidate.note.resources) {
        const file = await fileFor(resource.md5, false)
        if (!file) continue
        resolved.set(resource.md5, { fileId: file.id, isImage: file.image, fileName: file.name })
        if (!file.image) attachments.push(file.id)
      }
      const html = enmlToHtml(candidate.note.content, (hash) => resolved.get(hash))
      const archiveId = noteArchive.get(noteKey(candidate))!
      const reference = await repo.create('references', {
        title: candidate.note.title,
        html,
        tags: candidate.note.tags,
        objectIds: [],
        plantGroupIds: [],
        fileIds: attachments,
        source: { app: 'evernote', archiveItemIds: [archiveId], files: [candidate.fileName], fingerprint: noteKey(candidate) },
      })
      link([archiveId], reference.id)
      references++
    } catch (error) {
      errors.push(`Заметка «${candidate.note.title}»: ${error instanceof Error ? error.message : String(error)}`)
    }
    tick()
  }

  if (decisions.outside) {
    const seen = new Set<string>()
    const sections: string[] = []
    const attachments: string[] = []
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const linkify = (value: string) => escape(value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')
    const MONTHS = ['', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
    for (const group of [...proposal.outside].sort((a, b) => b.season - a.season)) {
      for (const item of group.items) {
        for (const hash of item.mediaHashes) {
          const file = await fileFor(hash, false)
          if (file && !attachments.includes(file.id)) attachments.push(file.id)
        }
        const key = textKey(item.text)
        if (!item.text || seen.has(key)) continue
        seen.add(key)
        sections.push(`<p><b>${item.month ? `После таблицы «${MONTHS[item.month]}»` : 'В начале заметки'} (${escape(group.noteTitle)})</b><br>${linkify(item.text)}</p>`)
      }
    }
    try {
      await repo.create('references', {
        title: 'Дневники Evernote: ссылки и заметки вне таблиц',
        html: sections.join(''),
        tags: ['evernote'],
        objectIds: [],
        plantGroupIds: [],
        fileIds: attachments,
        source: { app: 'evernote', archiveItemIds: [], files: [...new Set(proposal.outside.map((group) => group.fileName))], fingerprint: OUTSIDE_KEY },
      })
      references++
    } catch (error) {
      errors.push(`Заметки вне таблиц: ${error instanceof Error ? error.message : String(error)}`)
    }
    tick()
  }

  let archiveItems = 0
  for (const draft of archiveDrafts) {
    const { id, existing, ...content } = draft
    const createdRecordIds = [...new Set([...content.createdRecordIds, ...(createdFor.get(id) ?? [])])]
    try {
      if (!existing) {
        await repo.create('importArchive', { ...content, id, createdRecordIds })
        archiveItems++
      } else if (createdRecordIds.length !== existing.createdRecordIds.length) {
        await repo.update('importArchive', id, { createdRecordIds }, existing.revision)
      }
    } catch (error) {
      errors.push(`Архив «${content.text.slice(0, 40)}»: ${error instanceof Error ? error.message : String(error)}`)
    }
    tick()
  }

  return { snapshotId, events, planItems, references, files: createdFiles, archiveItems, errors }
}
