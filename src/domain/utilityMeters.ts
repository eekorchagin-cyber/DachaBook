import type { UtilityKind, UtilityReading } from './types'

export const UTILITY_KIND_LABEL: Record<UtilityKind, string> = {
  water: 'Вода',
  electricity: 'Электричество',
  gas: 'Газ',
  other: 'Другое',
}

export const DEFAULT_UTILITY_UNIT: Record<UtilityKind, string> = {
  water: 'м³',
  electricity: 'кВт·ч',
  gas: 'м³',
  other: 'ед.',
}

export interface MonthConsumption {
  /** ГГГГ-ММ */
  month: string
  /** Расход за месяц (сумма разниц показаний). */
  used: number
}

/** Расход между соседними показаниями: только рост счётчика, сброс/замена не считаются. */
export function readingDeltas(readings: UtilityReading[]): { date: string; used: number }[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const deltas: { date: string; used: number }[] = []
  for (let index = 1; index < sorted.length; index++) {
    const prev = sorted[index - 1]
    const next = sorted[index]
    const used = next.value - prev.value
    if (used > 0) deltas.push({ date: next.date, used })
  }
  return deltas
}

/** Сумма расходов по календарным месяцам даты показания. */
export function consumptionByMonth(readings: UtilityReading[]): MonthConsumption[] {
  const totals = new Map<string, number>()
  for (const delta of readingDeltas(readings)) {
    const month = delta.date.slice(0, 7)
    totals.set(month, (totals.get(month) ?? 0) + delta.used)
  }
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, used]) => ({ month, used: Math.round(used * 1000) / 1000 }))
}
