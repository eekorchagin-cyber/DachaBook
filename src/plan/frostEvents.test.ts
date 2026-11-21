import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../storage/db'
import { Repository } from '../storage/repository'
import { ensureFrostObservations, frostYearsToRecord } from './frostEvents'
import type { DailyMinimums } from './frost'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

function minimums(start: string, end: string, frosts: Record<string, number> = {}): DailyMinimums {
  const time: string[] = []
  for (let date = start; ; ) {
    time.push(date)
    if (date === end) break
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  }
  return { time, temperature_2m_min: time.map((date) => frosts[date] ?? 5) }
}

describe('заморозки в дневнике', () => {
  it('склеивает архив и прогноз без потери дат', () => {
    const forecast = minimums('2026-09-01', '2026-09-20', { '2026-09-12': -1 })
    expect(frostYearsToRecord([{ year: 2025, lastSpring: '2025-05-10', firstAutumn: '2025-09-18' }], forecast, '2026-09-15')).toEqual([
      { year: 2025, lastSpring: '2025-05-10', firstAutumn: '2025-09-18' },
      { year: 2026, firstAutumn: '2026-09-12' },
    ])
  })

  it('добавляет наблюдения один раз на год и не дублирует', async () => {
    const seeder = new Repository(db, () => 'Егор')
    await seeder.create('objects', { name: 'Участок целиком', type: 'place', active: true })
    const first = await ensureFrostObservations(db, [{ year: 2025, lastSpring: '2025-05-10', firstAutumn: '2025-09-18' }], undefined, '2026-11-20')
    expect(first).toBe(2)
    const events = await db.events.toArray()
    expect(events.map((event) => event.comment)).toEqual([
      'Последние весенние заморозки на участке (10.05).',
      'Первые осенние заморозки на участке (18.09).',
    ])
    expect(await ensureFrostObservations(db, [{ year: 2025, lastSpring: '2025-05-10', firstAutumn: '2025-09-18' }], undefined, '2026-11-20')).toBe(0)
  })
})
