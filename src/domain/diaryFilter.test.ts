import { describe, expect, it } from 'vitest'
import { filterEvents } from './diaryFilter'
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
