import type { PlanPeriod } from '../domain/types'
import { isDiaryNote, parseDiaryTable, parseRawDate, type DiaryRow, type OutsideText } from './enex/diaryTable'
import type { EnexNote, EnexResource } from './enex/parser'
import { canSplit } from './split'
import { looksLikeWork, similarity, suggestObject, suggestWorkKind, textKey } from './suggest'

/** Строка дневника вместе с файлом и сезоном, откуда она взята. */
export interface SourceRow {
  fileName: string
  noteTitle: string
  season: number
  row: DiaryRow
}

export interface EventCandidate {
  /** Ключ защиты от дублей: дата и текст (для неподтверждённых дат — исходное написание даты и текст). */
  key: string
  date?: string
  suggestion?: string
  needsConfirmation: boolean
  text: string
  /** Близкие варианты текста на ту же дату; первый — из самого позднего файла. */
  variants: string[]
  type: 'work' | 'observation'
  /** Тип «работа» предложен по тексту, а не по флажку: требует внимания. */
  typeSuggested: boolean
  objectName: string
  workKind?: string
  sources: SourceRow[]
  mediaHashes: string[]
  /** Несколько предложений разного типа: стоит разделить на отдельные записи. */
  splittable: boolean
}

export interface PlanCandidate {
  key: string
  itemType: 'work' | 'observation'
  text: string
  periods: PlanPeriod[]
  seasonsDone: number[]
  /** Есть только в шаблонах прошлых лет: добавляется в черновик по выбору пользователя. */
  fromPastOnly: boolean
  sources: SourceRow[]
  mediaHashes: string[]
  splittable: boolean
}

export interface NoteCandidate {
  fileName: string
  note: EnexNote
}

export interface OutsideCandidate {
  fileName: string
  noteTitle: string
  season: number
  items: OutsideText[]
}

/** Фрагмент вне таблиц (ссылка, текст, картинка, файл) с записью, над которой он стоял в Evernote. */
export interface OutsidePiece {
  key: string
  fileName: string
  noteTitle: string
  season: number
  month: number
  text: string
  mediaHashes: string[]
  above?: SourceRow
}

export interface ImportFile {
  fileName: string
  notes: EnexNote[]
}

export interface ImportProposal {
  events: EventCandidate[]
  plan: PlanCandidate[]
  notes: NoteCandidate[]
  outside: OutsideCandidate[]
  /** Фрагменты вне таблиц без повторов между файлами (берётся самый поздний файл). */
  outsidePieces: OutsidePiece[]
  rows: SourceRow[]
  resources: Map<string, EnexResource>
  latestSeason?: number
}

/** Сезон заметки — год в названии (раздел 3 ТЗ), иначе год создания заметки. */
export function noteSeason(note: EnexNote): number {
  const fromTitle = note.title.match(/(20\d{2})/)
  if (fromTitle) return Number(fromTitle[1])
  return Number(note.created?.slice(0, 4)) || new Date().getFullYear()
}

const NEAR_DUPLICATE = 0.85

function addPeriod(periods: PlanPeriod[], period: PlanPeriod): void {
  if (!periods.some((item) => item.month === period.month && item.week === period.week)) periods.push(period)
}

function weekNumber(week: string | undefined): number | undefined {
  const value = Number(week)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Строит предложение импорта по правилам раздела 3 ТЗ; в базу ничего не пишет. */
export function buildProposal(files: ImportFile[]): ImportProposal {
  const rows: SourceRow[] = []
  const notes: NoteCandidate[] = []
  const outside: OutsideCandidate[] = []
  const resources = new Map<string, EnexResource>()

  for (const file of files) {
    for (const note of file.notes) {
      note.resources.forEach((resource) => resources.set(resource.md5, resource))
      if (!isDiaryNote(note.content)) {
        notes.push({ fileName: file.fileName, note })
        continue
      }
      const season = noteSeason(note)
      const table = parseDiaryTable(note.content)
      table.rows.forEach((row) => rows.push({ fileName: file.fileName, noteTitle: note.title, season, row }))
      if (table.outside.length > 0) outside.push({ fileName: file.fileName, noteTitle: note.title, season, items: table.outside })
    }
  }

  const latestSeason = rows.length > 0 ? Math.max(...rows.map((source) => source.season)) : undefined
  const bySeasonDesc = [...rows].sort((a, b) => b.season - a.season || a.row.index - b.row.index)

  const events = new Map<string, EventCandidate>()
  const plan = new Map<string, PlanCandidate>()

  for (const source of bySeasonDesc) {
    const { row, season } = source
    const parsed = parseRawDate(row.rawDate, season)
    const hasBox = row.checkbox !== 'none'
    const key = textKey(row.text)

    if (parsed.status !== 'none') {
      const eventKey = parsed.status === 'ok' ? `${parsed.date}|${key}` : `?${textKey(row.rawDate)}|${key}`
      const existing = events.get(eventKey)
      if (existing) {
        existing.sources.push(source)
        if (hasBox && existing.type === 'observation') existing.type = 'work'
        for (const hash of row.mediaHashes) if (!existing.mediaHashes.includes(hash)) existing.mediaHashes.push(hash)
      } else {
        const work = hasBox || looksLikeWork(row.text)
        events.set(eventKey, {
          key: eventKey,
          date: parsed.date,
          suggestion: parsed.suggestion,
          needsConfirmation: parsed.status === 'needs-confirmation',
          text: row.text,
          variants: [row.text],
          type: work ? 'work' : 'observation',
          typeSuggested: work && !hasBox,
          objectName: suggestObject(row.text),
          workKind: work ? suggestWorkKind(row.text) : undefined,
          sources: [source],
          mediaHashes: [...row.mediaHashes],
          splittable: canSplit(row.text),
        })
      }
    }

    if (hasBox || parsed.status === 'none') {
      const itemType = hasBox ? 'work' : 'observation'
      const planKey = `${itemType}|${key}`
      const candidate =
        plan.get(planKey) ??
        ({ key: planKey, itemType, text: row.text, periods: [], seasonsDone: [], fromPastOnly: true, sources: [], mediaHashes: [], splittable: canSplit(row.text) } as PlanCandidate)
      addPeriod(candidate.periods, { month: row.month, week: weekNumber(row.week) })
      if (row.checkbox === 'checked' && !candidate.seasonsDone.includes(season)) candidate.seasonsDone.push(season)
      if (season === latestSeason) candidate.fromPastOnly = false
      for (const hash of row.mediaHashes) if (!candidate.mediaHashes.includes(hash)) candidate.mediaHashes.push(hash)
      candidate.sources.push(source)
      plan.set(planKey, candidate)
    }
  }

  // Близкие тексты на одну дату (опечатка, дописанная фраза) сводятся в одно событие с вариантами.
  const merged: EventCandidate[] = []
  const byDate = new Map<string, EventCandidate[]>()
  for (const candidate of events.values()) {
    if (!candidate.date) {
      merged.push(candidate)
      continue
    }
    const sameDay = byDate.get(candidate.date) ?? []
    const twin = sameDay.find((item) => similarity(item.text, candidate.text) >= NEAR_DUPLICATE)
    if (twin) {
      twin.variants.push(candidate.text)
      twin.sources.push(...candidate.sources)
      for (const hash of candidate.mediaHashes) if (!twin.mediaHashes.includes(hash)) twin.mediaHashes.push(hash)
    } else {
      sameDay.push(candidate)
      byDate.set(candidate.date, sameDay)
      merged.push(candidate)
    }
  }

  const pieces = new Map<string, OutsidePiece>()
  for (const group of [...outside].sort((a, b) => b.season - a.season)) {
    for (const item of group.items) {
      const key = `${textKey(item.text)}|${item.mediaHashes.join(',')}`
      if (pieces.has(key)) continue
      const above = rows.find((source) => source.fileName === group.fileName && source.noteTitle === group.noteTitle && source.row.index === item.afterRowIndex)
      pieces.set(key, { key, fileName: group.fileName, noteTitle: group.noteTitle, season: group.season, month: item.month, text: item.text, mediaHashes: item.mediaHashes, above })
    }
  }

  for (const candidate of plan.values()) candidate.seasonsDone.sort()
  const sortEvents = (a: EventCandidate, b: EventCandidate) => (a.date ?? a.suggestion ?? '').localeCompare(b.date ?? b.suggestion ?? '')
  const firstPeriod = (item: PlanCandidate) => item.periods[0].month * 10 + (item.periods[0].week ?? 0)

  return {
    events: merged.sort(sortEvents),
    plan: [...plan.values()].sort((a, b) => firstPeriod(a) - firstPeriod(b)),
    notes,
    outside,
    outsidePieces: [...pieces.values()],
    rows,
    resources,
    latestSeason,
  }
}
