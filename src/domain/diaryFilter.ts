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

/** Регистр и «ё» не влияют на поиск. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е')
}

/** От последней записи к более ранним: дата события, время, затем порядок внесения (у импорта — порядок строк таблицы). */
export function compareEvents(a: DiaryEvent, b: DiaryEvent): number {
  return b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** Фильтры работают в любом сочетании и без сети; удалённые записи не показываются. */
export function filterEvents(events: DiaryEvent[], filter: DiaryFilter): DiaryEvent[] {
  const words = normalizeText(filter.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return events
    .filter((event) => {
      if (event.deletedAt) return false
      if (filter.type && event.type !== filter.type) return false
      if (filter.from && event.date < filter.from) return false
      if (filter.to && event.date > filter.to) return false
      if (filter.objectId && !event.objectIds.includes(filter.objectId)) return false
      if (filter.plantGroupId && !event.plantGroupIds.includes(filter.plantGroupId)) return false
      if (filter.workKind && event.workKind !== filter.workKind) return false
      if (words.length > 0) {
        const haystack = normalizeText(`${event.comment} ${event.workKind ?? ''}`)
        if (!words.every((word) => haystack.includes(word))) return false
      }
      return true
    })
    .sort(compareEvents)
}
