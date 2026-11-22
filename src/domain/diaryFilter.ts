import { rangeText } from './dates'
import type { DiaryEvent, EventType } from './types'

export interface DiaryFilter {
  text?: string
  from?: string
  to?: string
  objectId?: string
  plantGroupId?: string
  workKind?: string
  type?: EventType
}

const EVENT_TYPES: EventType[] = ['work', 'observation', 'measurement']

const TYPE_LABEL: Record<EventType, string> = {
  work: 'работы',
  observation: 'наблюдения',
  measurement: 'измерения',
}

/** Есть ли хотя бы одно условие отбора (не считая пустой строки поиска). */
export function hasDiaryFilter(filter: DiaryFilter): boolean {
  return Boolean(
    filter.text?.trim() || filter.from || filter.to || filter.objectId || filter.plantGroupId || filter.workKind || filter.type,
  )
}

/** Читает фильтр дневника из query hash-роутера. */
export function diaryFilterFromQuery(query: URLSearchParams): DiaryFilter {
  const type = query.get('type')
  return {
    text: query.get('text') || undefined,
    from: query.get('from') || undefined,
    to: query.get('to') || undefined,
    objectId: query.get('objectId') || undefined,
    plantGroupId: query.get('plantGroupId') || undefined,
    workKind: query.get('workKind') || undefined,
    type: type && EVENT_TYPES.includes(type as EventType) ? (type as EventType) : undefined,
  }
}

/** Query-строка для перехода на экспорт PDF / ленту с тем же отбором. */
export function diaryFilterToQuery(filter: DiaryFilter): string {
  const params = new URLSearchParams()
  if (filter.text?.trim()) params.set('text', filter.text.trim())
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  if (filter.objectId) params.set('objectId', filter.objectId)
  if (filter.plantGroupId) params.set('plantGroupId', filter.plantGroupId)
  if (filter.workKind) params.set('workKind', filter.workKind)
  if (filter.type) params.set('type', filter.type)
  return params.toString()
}

export function diaryBookHref(filter: DiaryFilter = {}): string {
  const query = diaryFilterToQuery(filter)
  return query ? `#/diary/book?${query}` : '#/diary/book'
}

function entriesWord(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} записей`
  if (mod10 === 1) return `${count} запись`
  if (mod10 >= 2 && mod10 <= 4) return `${count} записи`
  return `${count} записей`
}

/** Краткие части отбора для подписи: период, поиск, объект, группа, вид работы, тип. */
export function diaryFilterParts(
  filter: DiaryFilter,
  names?: { object?: string; plantGroup?: string },
): string[] {
  const parts: string[] = []
  const period = rangeText(filter.from, filter.to)
  if (period) parts.push(period)
  if (filter.text?.trim()) parts.push(`поиск «${filter.text.trim()}»`)
  if (filter.objectId) parts.push(names?.object || 'объект')
  if (filter.plantGroupId) parts.push(names?.plantGroup || 'группа растений')
  if (filter.workKind) parts.push(filter.workKind)
  if (filter.type) parts.push(TYPE_LABEL[filter.type])
  return parts
}

/** Подзаголовок обложки PDF при отборе: «Отбор · 12 записей · …». Без фильтра — undefined. */
export function diarySelectionLabel(
  filter: DiaryFilter,
  entryCount: number,
  names?: { object?: string; plantGroup?: string },
): string | undefined {
  if (!hasDiaryFilter(filter)) return undefined
  return ['Отбор', entriesWord(entryCount), ...diaryFilterParts(filter, names)].join(' · ')
}

/** Регистр и «ё» не влияют на поиск. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е')
}

/** Все слова запроса должны встретиться в тексте. Пустой запрос подходит ко всему. */
export function includesAllWords(query: string, text: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeText(text)
  return words.every((word) => haystack.includes(word))
}

/** Кусок текста вокруг первого найденного слова. Индексы совпадают: «ё» заменяется на «е» той же длины. */
export function excerptAround(query: string, text: string, radius = 48): string | undefined {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  const haystack = normalizeText(text)
  const at = words.map((word) => haystack.indexOf(word)).find((index) => index >= 0)
  if (at === undefined || at < 0) return undefined
  const longest = Math.max(...words.map((word) => word.length))
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + radius + longest)
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`
}

/** От последней записи к более ранним: дата события, время, затем порядок внесения (у импорта — порядок строк таблицы). */
export function compareEvents(a: DiaryEvent, b: DiaryEvent): number {
  return b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** Фильтры работают в любом сочетании и без сети; удалённые записи не показываются. */
export function filterEvents(events: DiaryEvent[], filter: DiaryFilter): DiaryEvent[] {
  return events
    .filter((event) => {
      if (event.deletedAt) return false
      if (filter.type && event.type !== filter.type) return false
      if (filter.from && event.date < filter.from) return false
      if (filter.to && event.date > filter.to) return false
      if (filter.objectId && !event.objectIds.includes(filter.objectId)) return false
      if (filter.plantGroupId && !event.plantGroupIds.includes(filter.plantGroupId)) return false
      if (filter.workKind && event.workKind !== filter.workKind) return false
      return includesAllWords(filter.text ?? '', `${event.comment} ${event.workKind ?? ''}`)
    })
    .sort(compareEvents)
}
