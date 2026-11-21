import { describe, expect, it } from 'vitest'
import { consumptionByMonth, readingDeltas } from './utilityMeters'
import type { UtilityReading } from './types'

function reading(partial: Partial<UtilityReading> & Pick<UtilityReading, 'id' | 'date' | 'value'>): UtilityReading {
  return {
    schemaVersion: 1,
    revision: 'r',
    createdAt: partial.createdAt ?? `${partial.date}T12:00:00.000Z`,
    updatedAt: partial.createdAt ?? `${partial.date}T12:00:00.000Z`,
    createdBy: 'Егор',
    updatedBy: 'Егор',
    checksum: 'x',
    meterId: 'm1',
    ...partial,
  }
}

describe('счётчики', () => {
  it('считает расход как разницу соседних показаний', () => {
    const readings = [
      reading({ id: 'a', date: '2026-01-01', value: 100 }),
      reading({ id: 'b', date: '2026-02-01', value: 130 }),
      reading({ id: 'c', date: '2026-02-15', value: 145 }),
    ]
    expect(readingDeltas(readings)).toEqual([
      { date: '2026-02-01', used: 30 },
      { date: '2026-02-15', used: 15 },
    ])
    expect(consumptionByMonth(readings)).toEqual([
      { month: '2026-02', used: 45 },
    ])
  })

  it('игнорирует сброс или замену счётчика', () => {
    const readings = [
      reading({ id: 'a', date: '2026-03-01', value: 900 }),
      reading({ id: 'b', date: '2026-04-01', value: 10 }),
      reading({ id: 'c', date: '2026-05-01', value: 40 }),
    ]
    expect(readingDeltas(readings)).toEqual([{ date: '2026-05-01', used: 30 }])
    expect(consumptionByMonth(readings)).toEqual([{ month: '2026-05', used: 30 }])
  })
})
