import { describe, expect, it } from 'vitest'
import { addDays, evaluateCondition, frostStats, frostYears, nextWeekday, type DailyMinimums } from './frost'

/** Суточные минимумы: по умолчанию +5 °C, заморозки — в указанные даты. */
function minimums(start: string, end: string, frosts: Record<string, number> = {}): DailyMinimums {
  const time: string[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) time.push(date)
  return { time, temperature_2m_min: time.map((date) => frosts[date] ?? 5) }
}

describe('заморозки', () => {
  it('по годам: последний весенний и первый осенний; многолетние обычные, ранние и поздние даты', () => {
    const years = frostYears(
      minimums('2023-01-01', '2025-12-31', {
        '2023-05-10': -1,
        '2023-05-20': -2,
        '2023-09-15': -1,
        '2023-10-01': -3,
        '2024-05-25': -1,
        '2024-09-25': -2,
        '2025-05-15': -1,
        '2025-10-05': -1,
      }),
    )
    expect(years).toEqual([
      { year: 2023, lastSpring: '2023-05-20', firstAutumn: '2023-09-15' },
      { year: 2024, lastSpring: '2024-05-25', firstAutumn: '2024-09-25' },
      { year: 2025, lastSpring: '2025-05-15', firstAutumn: '2025-10-05' },
    ])
    expect(frostStats(years)).toEqual({
      years: 3,
      spring: { median: '05-20', earliest: '05-15', latest: '05-25' },
      autumn: { median: '09-25', earliest: '09-15', latest: '10-05' },
    })
  })

  it('ближайшая суббота', () => {
    expect(nextWeekday('2026-05-06', 6)).toBe('2026-05-09')
    expect(nextWeekday('2026-05-09', 6)).toBe('2026-05-09')
  })

  const climate = { years: 10, spring: { median: '05-20', earliest: '05-01', latest: '06-05' }, autumn: { median: '09-20', earliest: '09-05', latest: '10-10' } }

  it('слив водопровода: заморозок в прогнозе на неделю — срочно, до дня перед заморозком', () => {
    const forecast = minimums('2026-09-01', '2026-09-20', { '2026-09-14': -2 })
    const result = evaluateCondition({ type: 'beforeAutumnFrost', leadDays: 7 }, { today: '2026-09-10', forecast, climate })
    expect(result).toMatchObject({ state: 'ready', urgent: true, dueDate: '2026-09-13' })
    expect(result.message).toContain('14 сентября')
  })

  it('слив водопровода: без заморозков в прогнозе — за неделю до обычного срока по многолетним данным', () => {
    const forecast = minimums('2026-08-20', '2026-09-20')
    expect(evaluateCondition({ type: 'beforeAutumnFrost', leadDays: 7 }, { today: '2026-09-01', forecast, climate })).toMatchObject({ state: 'planned', dueDate: '2026-09-13' })
    expect(evaluateCondition({ type: 'beforeAutumnFrost', leadDays: 7 }, { today: '2026-09-14', forecast, climate })).toMatchObject({ state: 'ready', dueDate: '2026-09-19' })
    expect(evaluateCondition({ type: 'beforeAutumnFrost', leadDays: 7 }, { today: '2026-06-01', forecast, climate }).state).toBe('planned')
  })

  it('монтаж водопровода: пока есть заморозки — ждём; после 3 тёплых ночей и без заморозков в прогнозе — ближайшая суббота', () => {
    const condition = { type: 'afterSpringFrost' as const, weekday: 6 }
    const frosty = minimums('2026-04-28', '2026-05-20', { '2026-05-08': -1 })
    expect(evaluateCondition(condition, { today: '2026-05-04', forecast: frosty, climate })).toMatchObject({ state: 'waiting' })
    expect(evaluateCondition(condition, { today: '2026-05-10', forecast: frosty, climate })).toMatchObject({ state: 'waiting' })
    const warm = minimums('2026-04-28', '2026-05-20')
    expect(evaluateCondition(condition, { today: '2026-05-06', forecast: warm, climate })).toMatchObject({ state: 'ready', dueDate: '2026-05-09' })
  })

  it('без прогноза и многолетних данных — требуется проверка, а не «условия выполнены»', () => {
    expect(evaluateCondition({ type: 'afterSpringFrost' }, { today: '2026-05-06' }).state).toBe('check')
    expect(evaluateCondition({ type: 'beforeAutumnFrost', leadDays: 7 }, { today: '2026-09-06' }).state).toBe('check')
  })
})
