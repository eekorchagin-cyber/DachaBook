import type { DiaryEvent } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** «ММ-ДД» из даты записи. Пустая строка — дата не похожа на день дневника. */
export function monthDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : ''
}

/** Сдвиг календарной даты на несколько дней. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Записи этого месяца и дня за все годы, новые сверху. */
export function sameDayEvents(events: DiaryEvent[], date: string): DiaryEvent[] {
  const key = monthDay(date)
  if (!key) return []
  return events
    .filter((event) => !event.deletedAt && monthDay(event.date) === key)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

/** Те же записи, собранные по годам: сначала более поздний год. */
export function sameDayByYear(events: DiaryEvent[], date: string): { year: string; events: DiaryEvent[] }[] {
  const groups = new Map<string, DiaryEvent[]>()
  for (const event of sameDayEvents(events, date)) {
    const year = event.date.slice(0, 4)
    const list = groups.get(year) ?? []
    list.push(event)
    groups.set(year, list)
  }
  return [...groups.entries()].map(([year, items]) => ({ year, events: items }))
}
