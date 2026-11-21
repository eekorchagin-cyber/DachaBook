import { describe, expect, it } from 'vitest'
import { averageClimate, monthlyClimate } from './monthlyClimate'

describe('помесячный климат', () => {
  it('считает среднюю температуру и сумму осадков по месяцам', () => {
    const years = monthlyClimate({
      time: ['2024-01-01', '2024-01-02', '2024-02-01', '2025-01-15'],
      temperature_2m_max: [0, 4, 10, -2],
      temperature_2m_min: [-4, -2, 2, -8],
      precipitation_sum: [1, 3, 5, 2],
    })
    expect(years).toHaveLength(2)
    expect(years[0].year).toBe(2024)
    expect(years[0].months[0]).toMatchObject({ month: 1, tAvg: -0.5, tMin: -4, tMax: 4, precipMm: 4 })
    expect(years[0].months[1]).toMatchObject({ month: 2, tAvg: 6, precipMm: 5 })
    expect(years[1].months[0]).toMatchObject({ month: 1, tAvg: -5, precipMm: 2 })
  })

  it('усредняет месяцы по всем годам', () => {
    const years = monthlyClimate({
      time: ['2024-01-01', '2024-01-02', '2025-01-15'],
      temperature_2m_max: [0, 4, -2],
      temperature_2m_min: [-4, -2, -8],
      precipitation_sum: [1, 3, 2],
    })
    const all = averageClimate(years)
    expect(all.year).toBe(0)
    expect(all.months[0]).toMatchObject({ month: 1, tAvg: -2.7, precipMm: 3 })
  })
})
