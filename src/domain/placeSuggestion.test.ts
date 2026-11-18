import { describe, expect, it } from 'vitest'
import { groupByPlace, suggestStorage, type StoredThing } from './placeSuggestion'

const KINDS = ['Удобрение', 'Средство защиты', 'Семена и посадочный материал', 'Горюче-смазочные', 'Бытовая химия']

const stored: StoredThing[] = [
  { id: 'a', name: 'Азофоска', kind: 'Удобрение', place: 'Сарай, полка удобрений' },
  { id: 'f', name: 'Фертика', kind: 'Удобрение', place: 'Сарай, полка удобрений' },
  { id: 'm', name: 'Мульча еловая', place: 'Сарай, угол' },
  { id: 'o', name: 'Масло моторное', kind: 'Горюче-смазочные', place: 'Гараж, полка' },
  { id: 'v', name: 'Уксус', kind: 'Бытовая химия', place: 'Дом, шкаф' },
  { id: 'gone', name: 'Селитра', kind: 'Удобрение', place: 'Чулан', deletedAt: '2026-01-01' },
]

describe('куда положить новый материал', () => {
  it('кладёт похожее название туда, где уже лежит такое же', () => {
    expect(suggestStorage('Мульча из коры', stored, { kinds: KINDS })).toEqual({
      place: 'Сарай, угол',
      neighbors: ['Мульча еловая'],
      kind: undefined,
    })
  })

  it('для нового удобрения выбирает полку, где удобрений больше', () => {
    const suggestion = suggestStorage('Калийная соль', stored, { kinds: KINDS })
    expect(suggestion?.place).toBe('Сарай, полка удобрений')
    expect(suggestion?.neighbors).toEqual(['Азофоска', 'Фертика'])
    expect(suggestion?.kind).toBe('Удобрение')
  })

  it('не выбирает место, если похожие лежат в разных местах поровну', () => {
    const suggestion = suggestStorage(
      'Калийная соль',
      [
        { name: 'Азофоска', kind: 'Удобрение', place: 'Сарай' },
        { name: 'Фертика', kind: 'Удобрение', place: 'Подвал' },
      ],
      { kinds: KINDS },
    )
    expect(suggestion?.place).toBeUndefined()
    expect(suggestion?.kind).toBe('Удобрение')
  })

  it('не предлагает вид, которого нет в справочнике, и не смотрит на удалённые и на сам материал', () => {
    expect(suggestStorage('Калийная соль', stored, { kinds: ['Бытовая химия'] })?.kind).toBeUndefined()
    expect(suggestStorage('Селитра', stored, { kinds: KINDS })?.place).not.toBe('Чулан')
    expect(suggestStorage('Азофоска', stored, { kinds: KINDS, exceptId: 'a' })?.neighbors).toEqual(['Фертика'])
  })

  it('масло кладёт к маслу, а незнакомое название никуда не отправляет', () => {
    expect(suggestStorage('Масло 2Т', stored, { kinds: KINDS })?.place).toBe('Гараж, полка')
    expect(suggestStorage('Лопата', stored, { kinds: KINDS })).toBeUndefined()
    expect(suggestStorage('Аз', stored, { kinds: KINDS })).toBeUndefined()
  })

  it('собирает список по местам: места по алфавиту, без места в конце', () => {
    expect(
      groupByPlace([
        { name: 'Фертика', place: 'Сарай' },
        { name: 'Азофоска', place: 'Сарай' },
        { name: 'Уксус' },
        { name: 'Масло', place: 'Гараж' },
      ]).map((group) => ({ place: group.place, names: group.items.map((item) => item.name) })),
    ).toEqual([
      { place: 'Гараж', names: ['Масло'] },
      { place: 'Сарай', names: ['Азофоска', 'Фертика'] },
      { place: '', names: ['Уксус'] },
    ])
  })
})
