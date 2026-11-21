import { MONTH_NAMES } from './dates'

export interface MonthClimate {
  month: number
  /** Средняя суточная ((макс+мин)/2) за месяц, °C. */
  tAvg: number | null
  tMin: number | null
  tMax: number | null
  /** Сумма осадков за месяц, мм. */
  precipMm: number | null
}

export interface YearClimate {
  year: number
  months: MonthClimate[]
}

export interface DailyClimateSeries {
  time: string[]
  temperature_2m_max: (number | null)[]
  temperature_2m_min: (number | null)[]
  precipitation_sum: (number | null)[]
}

const emptyMonths = (): MonthClimate[] =>
  Array.from({ length: 12 }, (_, index) => ({ month: index + 1, tAvg: null, tMin: null, tMax: null, precipMm: null }))

const round1 = (value: number) => Math.round(value * 10) / 10

/** Суточные ряды → средние температуры и сумма осадков по месяцам каждого года. */
export function monthlyClimate(daily: DailyClimateSeries): YearClimate[] {
  const years = new Map<number, { months: ReturnType<typeof emptyMonths>; counts: number[]; precip: (number | null)[]; tMin: (number | null)[]; tMax: (number | null)[]; tSum: number[] }>()
  daily.time.forEach((date, index) => {
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    if (!year || month < 1 || month > 12) return
    const bucket = years.get(year) ?? { months: emptyMonths(), counts: Array(12).fill(0), precip: Array(12).fill(null), tMin: Array(12).fill(null), tMax: Array(12).fill(null), tSum: Array(12).fill(0) }
    const slot = month - 1
    const max = daily.temperature_2m_max[index]
    const min = daily.temperature_2m_min[index]
    const precip = daily.precipitation_sum[index]
    if (max !== null && max !== undefined) {
      bucket.tMax[slot] = bucket.tMax[slot] === null ? max : Math.max(bucket.tMax[slot]!, max)
    }
    if (min !== null && min !== undefined) {
      bucket.tMin[slot] = bucket.tMin[slot] === null ? min : Math.min(bucket.tMin[slot]!, min)
    }
    if (max !== null && max !== undefined && min !== null && min !== undefined) {
      bucket.tSum[slot] += (max + min) / 2
      bucket.counts[slot]++
    }
    if (precip !== null && precip !== undefined) {
      bucket.precip[slot] = (bucket.precip[slot] ?? 0) + precip
    }
    years.set(year, bucket)
  })
  return [...years.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, bucket]) => ({
      year,
      months: bucket.months.map((month, index) => ({
        month: month.month,
        tAvg: bucket.counts[index] ? round1(bucket.tSum[index] / bucket.counts[index]) : null,
        tMin: bucket.tMin[index] === null ? null : round1(bucket.tMin[index]!),
        tMax: bucket.tMax[index] === null ? null : round1(bucket.tMax[index]!),
        precipMm: bucket.precip[index] === null ? null : round1(bucket.precip[index]!),
      })),
    }))
}

/** Средние по месяцам за все годы ряда: норма температуры и типичная сумма осадков. */
export function averageClimate(years: YearClimate[]): YearClimate {
  const months = emptyMonths().map((month, index) => {
    const tAvg: number[] = []
    const tMin: number[] = []
    const tMax: number[] = []
    const precip: number[] = []
    for (const year of years) {
      const cell = year.months[index]
      if (!cell) continue
      if (cell.tAvg !== null) tAvg.push(cell.tAvg)
      if (cell.tMin !== null) tMin.push(cell.tMin)
      if (cell.tMax !== null) tMax.push(cell.tMax)
      if (cell.precipMm !== null) precip.push(cell.precipMm)
    }
    const mean = (values: number[]) => (values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null)
    return {
      month: month.month,
      tAvg: mean(tAvg),
      tMin: mean(tMin),
      tMax: mean(tMax),
      precipMm: mean(precip),
    }
  })
  return { year: 0, months }
}

export const monthLabel = (month: number) => MONTH_NAMES[month - 1]?.slice(0, 3) ?? String(month)
