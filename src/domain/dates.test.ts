import { describe, expect, it } from 'vitest'
import { rangeText } from './dates'

describe('период дневника по-русски', () => {
  it('день, неделя, месяцы одного года, разные годы', () => {
    expect(rangeText('2024-05-05', '2024-05-05')).toBe('5 мая 2024')
    expect(rangeText('2024-05-01', '2024-05-07')).toBe('1–7 мая 2024')
    expect(rangeText('2024-05-01', '2024-06-30')).toBe('1 мая — 30 июня 2024')
    expect(rangeText('2023-12-01', '2024-01-31')).toBe('1 декабря 2023 — 31 января 2024')
    expect(rangeText('2024-05-01')).toBe('с 1 мая 2024')
  })
})
