import type { Consumable, ConsumableUse, DiaryEvent } from './types'

export const UNITS = ['кг', 'г', 'л', 'мл', 'шт.', 'уп.', 'м', 'м²', 'м³']

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

export function quantityText(value: number, unit: string): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${unit}`
}

export function parseQuantity(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.').trim())
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Расход каждого материала за год по записям дневника (без записей в корзине). */
export function usageByConsumable(events: Pick<DiaryEvent, 'date' | 'deletedAt' | 'consumables'>[], year: number): Map<string, number> {
  const usage = new Map<string, number>()
  for (const event of events) {
    if (event.deletedAt || !event.date.startsWith(`${year}-`)) continue
    for (const use of event.consumables ?? []) usage.set(use.consumableId, (usage.get(use.consumableId) ?? 0) + use.quantity)
  }
  return usage
}

export interface ConsumableRow {
  name: string
  quantity: string
  /** Единица для нового материала; у существующего берётся из справочника. */
  unit: string
}

export function findConsumable(consumables: Consumable[], name: string): Consumable | undefined {
  const key = normalizeName(name)
  return key ? consumables.find((item) => !item.deletedAt && normalizeName(item.name) === key) : undefined
}

export function rowProblems(rows: ConsumableRow[]): string[] {
  const list: string[] = []
  for (const row of rows) {
    if (row.name.trim() && parseQuantity(row.quantity) === undefined) list.push(`укажите количество для «${row.name.trim()}»`)
    if (!row.name.trim() && row.quantity.trim()) list.push('укажите название расходного материала')
  }
  return list
}

/**
 * Строки формы → расход в записи. Неизвестные названия становятся новыми материалами справочника (через create),
 * повторы одного материала складываются.
 */
export async function resolveUses(rows: ConsumableRow[], consumables: Consumable[], create: (name: string, unit: string) => Promise<Consumable>): Promise<ConsumableUse[]> {
  const known = [...consumables]
  const uses: ConsumableUse[] = []
  for (const row of rows) {
    const quantity = parseQuantity(row.quantity)
    if (!row.name.trim() || quantity === undefined) continue
    let consumable = findConsumable(known, row.name)
    if (!consumable) {
      consumable = await create(row.name.trim().replace(/\s+/g, ' '), row.unit.trim() || 'шт.')
      known.push(consumable)
    }
    const existing = uses.find((use) => use.consumableId === consumable.id)
    if (existing) existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000
    else uses.push({ consumableId: consumable.id, quantity })
  }
  return uses
}
