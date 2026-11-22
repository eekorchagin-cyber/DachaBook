import { describe, expect, it } from 'vitest'
import {
  diaryBookHref,
  diaryFilterFromQuery,
  diaryFilterToQuery,
  diarySelectionLabel,
  excerptAround,
  filterEvents,
  hasDiaryFilter,
  includesAllWords,
} from './diaryFilter'
import type { DiaryEvent } from './types'

function event(partial: Partial<DiaryEvent>): DiaryEvent {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    revision: 'r',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'a',
    updatedBy: 'a',
    checksum: '',
    type: 'work',
    date: '2025-05-01',
    objectIds: [],
    plantGroupIds: [],
    comment: '',
    photoIds: [],
    attachmentIds: [],
    ...partial,
  }
}

const events = [
  event({ date: '2025-05-18', comment: 'Газон прочесал и удобрил Фертика', objectIds: ['lawn'], workKind: 'Подкормка' }),
  event({ date: '2021-05-10', comment: 'Обработали участок от клещей', objectIds: ['site'] }),
  event({ date: '2025-06-01', type: 'observation', comment: 'Ёлки пожелтели', objectIds: ['garden'], plantGroupIds: ['conifers'] }),
  event({ date: '2025-07-01', comment: 'удалённая', deletedAt: '2026-01-02T00:00:00Z' }),
]

describe('filterEvents', () => {
  it('сортирует по дате события, новые сверху, и скрывает корзину', () => {
    expect(filterEvents(events, {}).map((item) => item.date)).toEqual(['2025-06-01', '2025-05-18', '2021-05-10'])
  })

  it('в один день: со временем — по времени, без времени — последняя внесённая сверху', () => {
    const sameDay = [
      event({ date: '2025-05-18', comment: 'первая строка', createdAt: '2026-10-25T10:00:00.001Z' }),
      event({ date: '2025-05-18', comment: 'вторая строка', createdAt: '2026-10-25T10:00:00.002Z' }),
      event({ date: '2025-05-18', comment: 'утром', time: '08:00', createdAt: '2026-10-25T09:00:00.000Z' }),
      event({ date: '2025-05-18', comment: 'вечером', time: '19:30', createdAt: '2026-10-25T09:00:00.000Z' }),
    ]
    expect(filterEvents(sameDay, {}).map((item) => item.comment)).toEqual(['вечером', 'утром', 'вторая строка', 'первая строка'])
  })

  it('ищет по словам без учёта регистра и «ё»', () => {
    expect(filterEvents(events, { text: 'елки' })).toHaveLength(1)
    expect(filterEvents(events, { text: 'газон фертика' })).toHaveLength(1)
    expect(filterEvents(events, { text: 'газон клещей' })).toHaveLength(0)
    expect(includesAllWords('', 'Смонтировать водопровод')).toBe(true)
    expect(includesAllWords('  Водопровод  субботу ', 'Смонтировать дачный водопровод в субботу')).toBe(true)
    expect(includesAllWords('слить насос', 'Слить воду, убрать насос')).toBe(true)
    expect(includesAllWords('слить газон', 'Слить воду, убрать насос')).toBe(false)
    expect(excerptAround('гортензии', 'На вертикальных грядках установили систему полива. Обрезали гортензии.')).toContain('гортензии')
    expect(excerptAround('гортензии', 'На вертикальных грядках установили систему полива.')).toBeUndefined()
  })

  it('сочетает период, объект, группу растений, вид работы и тип', () => {
    expect(filterEvents(events, { from: '2025-01-01', to: '2025-12-31' })).toHaveLength(2)
    expect(filterEvents(events, { objectId: 'lawn', workKind: 'Подкормка' })).toHaveLength(1)
    expect(filterEvents(events, { plantGroupId: 'conifers', type: 'observation' })).toHaveLength(1)
    expect(filterEvents(events, { objectId: 'lawn', type: 'observation' })).toHaveLength(0)
  })

  it('фильтрует 2000 записей быстрее 50 мс', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      event({ date: `20${10 + (i % 15)}-0${(i % 9) + 1}-1${i % 9}`, comment: `Запись ${i}: полив газона и подкормка` }),
    )
    const start = performance.now()
    filterEvents(many, { text: 'подкормка газона', from: '2015-01-01' })
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('фильтр в query и подпись отбора для PDF', () => {
  it('сериализует и читает все поля фильтра', () => {
    const filter = {
      text: 'редис',
      from: '2024-05-01',
      to: '2024-06-30',
      objectId: 'lawn',
      plantGroupId: 'conifers',
      workKind: 'Подкормка',
      type: 'work' as const,
    }
    const query = diaryFilterToQuery(filter)
    expect(query).toContain('text=%D1%80%D0%B5%D0%B4%D0%B8%D1%81')
    expect(diaryFilterFromQuery(new URLSearchParams(query))).toEqual(filter)
    expect(diaryBookHref(filter)).toBe(`#/diary/book?${query}`)
    expect(diaryBookHref({})).toBe('#/diary/book')
    expect(hasDiaryFilter({})).toBe(false)
    expect(hasDiaryFilter({ text: '  ' })).toBe(false)
    expect(hasDiaryFilter(filter)).toBe(true)
  })

  it('игнорирует неизвестный type в query', () => {
    expect(diaryFilterFromQuery(new URLSearchParams('type=note&text=газон'))).toEqual({ text: 'газон' })
  })

  it('собирает подпись отбора для обложки', () => {
    expect(diarySelectionLabel({}, 10)).toBeUndefined()
    expect(
      diarySelectionLabel({ from: '2024-05-01', to: '2024-05-01', text: 'редис', type: 'work' }, 1, {
        object: 'Газон',
      }),
    ).toBe('Отбор · 1 запись · 1 мая 2024 · поиск «редис» · работы')
    expect(diarySelectionLabel({ objectId: 'lawn', workKind: 'Полив' }, 12, { object: 'Газон' })).toBe(
      'Отбор · 12 записей · Газон · Полив',
    )
  })
})
