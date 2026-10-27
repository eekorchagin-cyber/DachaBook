import { MONTH_NAMES } from './dates'
import { compareEvents } from './diaryFilter'
import type { DiaryEvent } from './types'

export interface BookMonth {
  year: number
  month: number
  title: string
  events: DiaryEvent[]
}

export interface BookChapter {
  year: number
  title: string
  months: BookMonth[]
}

/** Книга дневника: главы — годы, параграфы — месяцы; внутри параграфа записи от ранних к поздним. */
export function diaryBook(events: DiaryEvent[], year?: number): BookChapter[] {
  const live = events
    .filter((event) => !event.deletedAt && event.date && (!year || event.date.startsWith(String(year))))
    .sort((a, b) => compareEvents(b, a))
  const chapters: BookChapter[] = []
  for (const event of live) {
    const yearValue = Number(event.date.slice(0, 4))
    const month = Number(event.date.slice(5, 7))
    let chapter = chapters.find((item) => item.year === yearValue)
    if (!chapter) {
      chapter = { year: yearValue, title: `Глава. ${yearValue}`, months: [] }
      chapters.push(chapter)
    }
    let paragraph = chapter.months.find((item) => item.month === month)
    if (!paragraph) {
      paragraph = { year: yearValue, month, title: `${MONTH_NAMES[month - 1]} ${yearValue}`, events: [] }
      chapter.months.push(paragraph)
    }
    paragraph.events.push(event)
  }
  return chapters
}

export function bookYears(events: DiaryEvent[]): number[] {
  return [...new Set(events.filter((event) => !event.deletedAt && event.date).map((event) => Number(event.date.slice(0, 4))))].sort((a, b) => a - b)
}

export function bookRange(chapters: BookChapter[]): string {
  if (chapters.length === 0) return ''
  const first = chapters[0].year
  const last = chapters[chapters.length - 1].year
  return first === last ? String(first) : `${first}–${last}`
}

export function bookPhotoCount(chapters: BookChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + chapter.months.reduce((monthSum, month) => monthSum + month.events.reduce((eventSum, event) => eventSum + event.photoIds.length, 0), 0), 0)
}
