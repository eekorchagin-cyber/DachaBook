import { quantityText } from './consumables'
import type { DiaryEvent } from './types'

const MASS: Record<string, number> = { г: 1, кг: 1000 }
const VOLUME: Record<string, number> = { мл: 1, л: 1000 }

export type PurchaseSource = 'rate' | 'season' | 'history' | 'none'

export interface PurchaseArea {
  name: string
  areaM2?: number
}

export interface PurchasePlan {
  source: PurchaseSource
  /** Сколько нужно на сезон, в единице материала. */
  need?: number
  /** Сколько уходит за одно внесение, в единице материала. */
  perUse?: number
  formula?: string
  used: number
  /** Запас в единице материала. Нет числа — запас не задан. */
  stock?: number
  toBuy?: number
  packs?: number
  warnings: string[]
}

function unitKey(unit: string): string {
  return unit.toLowerCase().replace(/ё/g, 'е').replace(/\.$/, '').trim()
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Перевод массы (г ↔ кг) и объёма (мл ↔ л). Несовместимые единицы — null. */
export function convertQuantity(quantity: number, from: string, to: string): number | null {
  const source = unitKey(from)
  const target = unitKey(to)
  if (source === target) return quantity
  if (MASS[source] && MASS[target]) return (quantity * MASS[source]) / MASS[target]
  if (VOLUME[source] && VOLUME[target]) return (quantity * VOLUME[source]) / VOLUME[target]
  return null
}

/** Удобная единица нормы: удобрения в кг считают граммами на м², жидкости в литрах — миллилитрами. */
export function suggestedRateUnit(unit: string): string {
  const key = unitKey(unit)
  if (key === 'кг') return 'г'
  if (key === 'л') return 'мл'
  return unit
}

/** Расход материала по прошлым годам: каждый год — отдельное число. Текущий год не входит. */
export function pastYearUsage(events: Pick<DiaryEvent, 'date' | 'deletedAt' | 'consumables'>[], consumableId: string, year: number): number[] {
  const totals = new Map<number, number>()
  for (const event of events) {
    if (event.deletedAt) continue
    const eventYear = Number(event.date.slice(0, 4))
    if (!eventYear || eventYear >= year) continue
    for (const use of event.consumables ?? []) {
      if (use.consumableId !== consumableId) continue
      totals.set(eventYear, (totals.get(eventYear) ?? 0) + use.quantity)
    }
  }
  return [...totals.values()]
}

/** «3» → 3. Пустое, дробное и меньше 1 — не число раз. */
export function parseApplications(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined
  const parsed = Number(value.trim())
  return parsed >= 1 ? parsed : undefined
}

/**
 * Сколько купить.
 * Норма одного внесения × площадь × сколько раз за сезон. Иначе число «на сезон», иначе максимум расхода прошлых лет.
 * Потребность — в единице материала, не в упаковках. Из неё вычитаются расход этого года и запас.
 */
export function purchasePlan(input: {
  unit: string
  seasonQuantity?: number
  ratePerM2?: number
  rateUnit?: string
  applications?: number
  stockQuantity?: number
  packQuantity?: number
  areas: PurchaseArea[]
  usedThisYear: number
  pastUsage: number[]
}): PurchasePlan {
  const warnings: string[] = []
  const used = round3(input.usedThisYear)
  let need: number | undefined
  let perUse: number | undefined
  let source: PurchaseSource = 'none'
  let formula: string | undefined

  if (input.ratePerM2) {
    const rated = input.areas.filter((area) => (area.areaM2 ?? 0) > 0)
    const missing = input.areas.filter((area) => !((area.areaM2 ?? 0) > 0))
    if (rated.length === 0) {
      warnings.push(input.areas.length ? 'У выбранных объектов не указана площадь — норма на м² не считается.' : 'Выберите объекты с площадью — иначе норма на м² не считается.')
    } else {
      const rateUnit = input.rateUnit?.trim() || input.unit
      const perM2 = convertQuantity(input.ratePerM2, rateUnit, input.unit)
      if (perM2 === null) warnings.push(`Единицу «${rateUnit}» нельзя перевести в «${input.unit}».`)
      else {
        const area = rated.reduce((sum, item) => sum + (item.areaM2 ?? 0), 0)
        const times = Math.max(1, Math.round(input.applications ?? 1))
        perUse = round3(area * perM2)
        need = round3(perUse * times)
        source = 'rate'
        formula = `${round3(area).toLocaleString('ru-RU')} м² × ${quantityText(input.ratePerM2, rateUnit)}/м² × ${times} = ${quantityText(need, input.unit)}`
        if (missing.length) warnings.push(`Без площади, в расчёт не вошли: ${missing.map((item) => item.name).join(', ')}.`)
      }
    }
  }

  if (need === undefined && input.seasonQuantity) {
    need = input.seasonQuantity
    source = 'season'
    formula = `на сезон задано ${quantityText(input.seasonQuantity, input.unit)}`
  }

  if (need === undefined && input.pastUsage.length > 0) {
    need = round3(Math.max(...input.pastUsage))
    source = 'history'
    formula = `по максимальному расходу прошлых лет: ${quantityText(need, input.unit)}`
  }

  const stock = input.stockQuantity
  let toBuy: number | undefined
  let packs: number | undefined
  if (need !== undefined && stock !== undefined) {
    toBuy = round3(Math.max(0, need - used - stock))
    if (input.packQuantity) packs = toBuy === 0 ? 0 : Math.ceil(toBuy / input.packQuantity - 1e-9)
  }

  return { source, need, perUse, formula, used, stock, toBuy, packs, warnings }
}

/** Строка для списка материалов. */
export function purchaseLine(plan: PurchasePlan, unit: string): string | undefined {
  if (!plan.formula) return undefined
  const parts = [plan.perUse !== undefined ? `на один раз ${quantityText(plan.perUse, unit)}` : '', plan.formula, `израсходовано ${quantityText(plan.used, unit)}`].filter(Boolean)
  if (plan.stock !== undefined) parts.push(`запас ${quantityText(plan.stock, unit)}`)
  if (plan.toBuy === undefined) parts.push('укажите запас, чтобы посчитать закупку')
  else if (plan.toBuy === 0) parts.push('покупать не нужно')
  else parts.push(plan.packs ? `купить ${quantityText(plan.toBuy, unit)} (${plan.packs} уп.)` : `купить ${quantityText(plan.toBuy, unit)}`)
  return parts.join(' · ')
}
