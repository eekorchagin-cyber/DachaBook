import { describe, expect, it } from 'vitest'
import { canSplit, splitSentences, suggestParts } from './split'

describe('splitSentences', () => {
  it('делит по предложениям', () => {
    expect(splitSentences('Листья опали. Убрали листву. Обвязал деревья защитной лентой.')).toEqual([
      'Листья опали.',
      'Убрали листву.',
      'Обвязал деревья защитной лентой.',
    ])
  })

  it('делит по точке с запятой и переносу строки', () => {
    expect(splitSentences('Смонтировал водопровод кроме полива\nКанализационный сток чистый; вода уходит')).toEqual([
      'Смонтировал водопровод кроме полива',
      'Канализационный сток чистый;',
      'вода уходит',
    ])
  })

  it('не делит инициалы, сокращения, даты, проценты и адреса', () => {
    expect(splitSentences('Обработка всех растений (рецепт Н.А. Гармашовой)')).toHaveLength(1)
    expect(splitSentences('Подкормка (2-5 ст.л. на 1 растение) раствором 0,3% мочевины')).toHaveLength(1)
    expect(splitSentences('Сняли 2.11.2019 урожай, см. https://iplants.ru/actara.htm для деталей')).toHaveLength(1)
  })
})

describe('подсказки частей', () => {
  it('пример заказчика: наблюдение, уборка, обслуживание деревьев', () => {
    const parts = suggestParts('Листья опали. Убрали листву. Обвязал деревья защитной лентой.')
    expect(parts.map((part) => part.type)).toEqual(['observation', 'work', 'work'])
    expect(parts[1].workKind).toBe('Уборка листвы и мусора')
    expect(parts[2].objectName).toBe('Сад')
    expect(parts[2].workKind).toBe('Подвязка, укрытие и защита растений')
    expect(parts[2].workKind).toBe('Подвязка, укрытие и защита растений')
    expect(canSplit('Листья опали. Убрали листву. Обвязал деревья защитной лентой.')).toBe(true)
  })

  it('однородную строку не помечает', () => {
    expect(canSplit('Скосил всю траву на участке')).toBe(false)
    expect(canSplit('Березы почти полностью сбросили листву. Ночью заморозок.')).toBe(false)
  })
})
