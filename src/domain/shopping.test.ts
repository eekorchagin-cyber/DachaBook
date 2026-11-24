import { describe, expect, it } from 'vitest'
import { mergeShoppingDraft, shoppingPackText, shoppingQuantityText } from './shopping'

describe('список Купить', () => {
  it('создаёт позицию к покупке и не дублирует материал', () => {
    const draft = { consumableId: 'lime', name: 'Известь', quantity: 2, unit: 'уп.', workId: 'w1' }
    expect(mergeShoppingDraft(undefined, draft)).toMatchObject({
      action: 'create',
      input: { consumableId: 'lime', quantity: 2, status: 'toBuy', workIds: ['w1'] },
    })
    const existing = { id: 's1', revision: 'r1', consumableId: 'lime', name: 'Известь', quantity: 2, unit: 'уп.', status: 'toBuy' as const, workIds: ['w1'] }
    expect(mergeShoppingDraft(existing, draft).action).toBe('skip')
    expect(mergeShoppingDraft(existing, { ...draft, quantity: 3, workId: 'w2' })).toMatchObject({
      action: 'update',
      input: { quantity: 3, workIds: ['w1', 'w2'] },
    })
  })

  it('купленную позицию снова ставит к покупке', () => {
    const existing = { id: 's1', revision: 'r1', consumableId: 'lime', name: 'Известь', quantity: 1, unit: 'уп.', status: 'bought' as const, workIds: [] }
    expect(mergeShoppingDraft(existing, { consumableId: 'lime', name: 'Известь', quantity: 2, unit: 'уп.' })).toMatchObject({
      action: 'update',
      input: { status: 'toBuy', quantity: 2 },
    })
  })

  it('нулевое количество не добавляет', () => {
    expect(mergeShoppingDraft(undefined, { consumableId: 'x', name: 'X', quantity: 0, unit: 'уп.' }).action).toBe('skip')
  })

  it('пишет количество с единицей', () => {
    expect(shoppingQuantityText({ quantity: 2, unit: 'уп.' })).toContain('2')
  })

  it('описывает фасовку упаковки', () => {
    expect(shoppingPackText({ quantity: 5, unit: 'уп.', packQuantity: 0.5, packUnit: 'кг' })).toBe('5 уп. × 0,5 кг')
    expect(shoppingPackText({ quantity: 2, unit: 'уп.' })).toBeUndefined()
  })
})
