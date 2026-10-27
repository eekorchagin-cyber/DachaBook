import { describe, expect, it } from 'vitest'
import { bookPhotoCount, bookRange, bookYears, diaryBook } from './diaryBook'
import type { DiaryEvent } from './types'

function event(id: string, date: string, extra: Partial<DiaryEvent> = {}): DiaryEvent {
  return {
    id,
    schemaVersion: 1,
    revision: id,
    createdAt: extra.createdAt ?? `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    createdBy: 'тест',
    updatedBy: 'тест',
    checksum: id,
    type: 'observation',
    date,
    objectIds: [],
    plantGroupIds: [],
    comment: id,
    photoIds: extra.photoIds ?? [],
    attachmentIds: [],
    ...extra,
  }
}

describe('книга дневника', () => {
  it('делит записи на главы-годы и параграфы-месяцы, от ранних к поздним', () => {
    const chapters = diaryBook([
      event('c', '2025-03-02'),
      event('a', '2024-12-31'),
      event('b', '2025-03-01', { time: '18:00' }),
      event('deleted', '2024-01-01', { deletedAt: '2026-01-01T00:00:00.000Z' }),
    ])
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Глава. 2024', 'Глава. 2025'])
    expect(chapters[0].months.map((month) => month.title)).toEqual(['Декабрь 2024'])
    expect(chapters[1].months.map((month) => month.title)).toEqual(['Март 2025'])
    expect(chapters[1].months[0].events.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('оставляет один год и считает годы, период и фото', () => {
    const events = [event('a', '2024-05-01', { photoIds: ['p1'] }), event('b', '2026-10-25', { photoIds: ['p2', 'p3'] })]
    expect(bookYears(events)).toEqual([2024, 2026])
    const year = diaryBook(events, 2026)
    expect(bookRange(year)).toBe('2026')
    expect(bookPhotoCount(year)).toBe(2)
    expect(bookRange(diaryBook(events))).toBe('2024–2026')
  })
})
