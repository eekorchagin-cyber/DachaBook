import type { DocInput, ShoppingItem } from './types'
import { quantityText } from './consumables'

/** Позиция, которую можно перенести в «Купить». */
export interface ShoppingDraft {
  consumableId: string
  name: string
  quantity: number
  unit: string
  workId?: string
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** Одна строка на материал: повторное добавление не создаёт дубль, а поднимает количество. */
export function mergeShoppingDraft(
  existing: Pick<ShoppingItem, 'id' | 'revision' | 'consumableId' | 'name' | 'quantity' | 'unit' | 'status' | 'workIds' | 'deletedAt'> | undefined,
  draft: ShoppingDraft,
): { action: 'create'; input: DocInput<ShoppingItem> } | { action: 'update'; id: string; revision: string; input: Partial<DocInput<ShoppingItem>> } | { action: 'skip' } {
  if (!(draft.quantity > 0)) return { action: 'skip' }
  if (!existing || existing.deletedAt) {
    return {
      action: 'create',
      input: {
        consumableId: draft.consumableId,
        name: draft.name,
        quantity: round3(draft.quantity),
        unit: draft.unit,
        status: 'toBuy',
        workIds: draft.workId ? [draft.workId] : [],
      },
    }
  }
  const workIds = draft.workId && !existing.workIds.includes(draft.workId) ? [...existing.workIds, draft.workId] : existing.workIds
  if (existing.status === 'toBuy') {
    const quantity = round3(Math.max(existing.quantity, draft.quantity))
    if (quantity === existing.quantity && workIds.length === existing.workIds.length && existing.name === draft.name && existing.unit === draft.unit) {
      return { action: 'skip' }
    }
    return { action: 'update', id: existing.id, revision: existing.revision, input: { name: draft.name, quantity, unit: draft.unit, workIds } }
  }
  return {
    action: 'update',
    id: existing.id,
    revision: existing.revision,
    input: { name: draft.name, quantity: round3(draft.quantity), unit: draft.unit, status: 'toBuy', workIds },
  }
}

/** Текст количества в списке. */
export function shoppingQuantityText(item: Pick<ShoppingItem, 'quantity' | 'unit'>): string {
  return quantityText(item.quantity, item.unit)
}

/** Подпись фасовки из справочника: «5 уп. × 0,5 кг». */
export function shoppingPackText(item: {
  quantity: number
  unit: string
  packQuantity?: number
  packUnit?: string
}): string | undefined {
  if (!(item.packQuantity && item.packQuantity > 0)) return undefined
  const pack = quantityText(item.packQuantity, item.packUnit?.trim() || 'ед.')
  return `${shoppingQuantityText(item)} × ${pack}`
}

const qtyRu = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })

/**
 * Одна строка для импорта в «Возьми» (family-lists):
 * `- [ ] Известь (0,5 кг): 5 уп.` — двоеточие, чтобы единица «уп.» не потерялась.
 */
export function shoppingVoimiLine(item: {
  name: string
  quantity: number
  unit: string
  packQuantity?: number
  packUnit?: string
}): string {
  const pack =
    item.packQuantity && item.packQuantity > 0
      ? ` (${qtyRu(item.packQuantity)} ${item.packUnit?.trim() || 'ед.'})`
      : ''
  return `- [ ] ${item.name.trim()}${pack}: ${qtyRu(item.quantity)} ${item.unit.trim()}`
}

/** Текст списка «к покупке» для буфера / .txt → «Возьми». */
export function shoppingVoimiText(
  items: Array<{
    name: string
    quantity: number
    unit: string
    packQuantity?: number
    packUnit?: string
  }>,
): string {
  return items.map(shoppingVoimiLine).join('\n')
}

export const SHOPPING_STATUS: Record<ShoppingItem['status'], string> = {
  toBuy: 'к покупке',
  bought: 'куплено',
}
