import type { DocInput, ShoppingItem } from './types'
import { quantityText } from './consumables'

/** Позиция, которую можно перенести в «Возьми». */
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

export const SHOPPING_STATUS: Record<ShoppingItem['status'], string> = {
  toBuy: 'к покупке',
  bought: 'куплено',
}
