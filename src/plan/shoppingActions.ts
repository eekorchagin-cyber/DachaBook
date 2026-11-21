import { mergeShoppingDraft, type ShoppingDraft } from '../domain/shopping'
import type { ShoppingItem } from '../domain/types'
import { repo } from '../app/store'
import { db } from '../storage/db'

/** Находит действующую строку «Купить» по материалу. */
export async function shoppingByConsumable(consumableId: string): Promise<ShoppingItem | undefined> {
  return (await db.shoppingItems.toArray()).find((item) => !item.deletedAt && item.consumableId === consumableId)
}

/** Переносит рассчитанные покупки в «Купить» без дублей материала. */
export async function addToShoppingList(drafts: ShoppingDraft[]): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0
  let updated = 0
  let skipped = 0
  for (const draft of drafts) {
    const existing = await shoppingByConsumable(draft.consumableId)
    const next = mergeShoppingDraft(existing, draft)
    if (next.action === 'skip') {
      skipped++
      continue
    }
    if (next.action === 'create') {
      await repo.create('shoppingItems', next.input)
      added++
      continue
    }
    await repo.update('shoppingItems', next.id, next.input, next.revision)
    updated++
  }
  return { added, updated, skipped }
}
