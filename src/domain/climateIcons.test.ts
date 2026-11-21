import { describe, expect, it } from 'vitest'
import { climateMonthIcon } from './climateIcons'
import type { MonthClimate } from './monthlyClimate'

function month(partial: Partial<MonthClimate>): MonthClimate {
  return { month: 1, tAvg: null, tMin: null, tMax: null, precipMm: null, ...partial }
}

describe('иконки климата', () => {
  it('снег при отрицательной средней или минимуме', () => {
    expect(climateMonthIcon(month({ tAvg: -2, precipMm: 10 }))).toBe('snow')
    expect(climateMonthIcon(month({ tAvg: 1, tMin: -3, precipMm: 0 }))).toBe('snow')
  })

  it('дождь при заметных осадках без мороза', () => {
    expect(climateMonthIcon(month({ tAvg: 12, precipMm: 40 }))).toBe('rain')
    expect(climateMonthIcon(month({ tAvg: 12, precipMm: 39 }))).toBe('none')
  })

  it('оба значка при морозе и осадках', () => {
    expect(climateMonthIcon(month({ tAvg: -1, precipMm: 50 }))).toBe('both')
  })
})
