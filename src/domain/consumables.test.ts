import { describe, expect, it } from 'vitest'
import { normalizeUrl, quantityText, resolveUses, rowProblems, urlHost, usageByConsumable } from './consumables'
import type { Consumable } from './types'

const azofoska = { id: 'a', name: 'Азофоска', unit: 'кг', objectIds: [], active: true } as unknown as Consumable

describe('расходные материалы', () => {
  it('считает расход за год без записей в корзине', () => {
    const usage = usageByConsumable(
      [
        { date: '2026-05-01', consumables: [{ consumableId: 'a', quantity: 2 }] },
        { date: '2026-06-01', consumables: [{ consumableId: 'a', quantity: 1.5 }, { consumableId: 'b', quantity: 3 }] },
        { date: '2025-06-01', consumables: [{ consumableId: 'a', quantity: 10 }] },
        { date: '2026-07-01', deletedAt: '2026-07-02', consumables: [{ consumableId: 'a', quantity: 10 }] },
      ],
      2026,
    )
    expect(Object.fromEntries(usage)).toEqual({ a: 3.5, b: 3 })
  })

  it('находит материал по названию без учёта регистра и «ё», новый создаёт один раз, повторы складывает', async () => {
    const created: string[] = []
    const uses = await resolveUses(
      [
        { name: ' азофоска ', quantity: '1,5', unit: '' },
        { name: 'Мульча еловая', quantity: '3', unit: 'уп.' },
        { name: 'мульча ёловая', quantity: '2', unit: '' },
        { name: 'Азофоска', quantity: '0.5', unit: '' },
        { name: '', quantity: '', unit: '' },
      ],
      [azofoska],
      async (name, unit) => {
        created.push(`${name}|${unit}`)
        return { ...azofoska, id: 'm', name, unit }
      },
    )
    expect(created).toEqual(['Мульча еловая|уп.'])
    expect(uses).toEqual([
      { consumableId: 'a', quantity: 2 },
      { consumableId: 'm', quantity: 5 },
    ])
  })

  it('подсказывает, чего не хватает, и показывает количество по-русски', () => {
    expect(rowProblems([{ name: 'Азофоска', quantity: '', unit: '' }, { name: '', quantity: '2', unit: '' }])).toEqual([
      'укажите количество для «Азофоска»',
      'укажите название расходного материала',
    ])
    expect(quantityText(2.5, 'кг')).toBe('2,5 кг')
  })

  it('проверяет и дополняет ссылку на источник', () => {
    expect(normalizeUrl('')).toBeUndefined()
    expect(normalizeUrl(' fertika.ru/products/gazon ')).toBe('https://fertika.ru/products/gazon')
    expect(normalizeUrl('http://shop.example.com/a?b=1')).toBe('http://shop.example.com/a?b=1')
    expect(normalizeUrl('азофоска')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(urlHost('https://www.fertika.ru/products')).toBe('fertika.ru')
  })
})
