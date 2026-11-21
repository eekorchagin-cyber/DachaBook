import { describe, expect, it } from 'vitest'
import { monthDay, sameDayByYear, sameDayEvents, shiftDate } from './sameDay'
import type { DiaryEvent } from './types'

const event = (date: string, extra: Partial<DiaryEvent> = {}) => ({ id: date, date, createdAt: date, deletedAt: undefined, ...extra }) as DiaryEvent

describe('этот день в разные годы', () => {
  const events = [
    event('2024-11-20'),
    event('2026-11-20', { createdAt: '2026-11-20T02:00:00.000Z' }),
    event('2026-11-20', { id: 'later', createdAt: '2026-11-20T03:00:00.000Z' }),
    event('2025-11-21'),
    event('2023-11-20', { deletedAt: '2023-11-21' }),
  ]

  it('берёт тот же месяц и день за все годы и пропускает удалённые', () => {
    expect(monthDay('2026-11-20')).toBe('11-20')
    expect(sameDayEvents(events, '2026-11-20').map((item) => item.id)).toEqual(['later', '2026-11-20', '2024-11-20'])
  })

  it('группирует по годам от новых к старым', () => {
    expect(sameDayByYear(events, '2026-11-20').map((group) => group.year)).toEqual(['2026', '2024'])
  })

  it('сдвигает дату через границу месяца', () => {
    expect(shiftDate('2026-11-20', 1)).toBe('2026-11-21')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})
