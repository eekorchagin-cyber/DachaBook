import { describe, expect, it } from 'vitest'
import { addRename, itemProblem, mergeDictionaries, mergeItems, moveItem, resolveRename, type DictionarySnapshot } from './dictionaries'

describe('справочники', () => {
  it('не допускает пустых и повторяющихся пунктов, в том числе с другим регистром и «ё»', () => {
    const items = ['Полив', 'Уборка листвы и мусора']
    expect(itemProblem(items, '  ')).toBe('Введите название')
    expect(itemProblem(items, ' полив ')).toBe('Такой пункт уже есть')
    expect(itemProblem(items, 'Полив', 'Полив')).toBeNull()
    expect(itemProblem(items, 'Мульчирование')).toBeNull()
  })

  it('меняет порядок, не выходя за края', () => {
    expect(moveItem(['а', 'б', 'в'], 2, -1)).toEqual(['а', 'в', 'б'])
    expect(moveItem(['а', 'б'], 0, -1)).toEqual(['а', 'б'])
  })

  it('помнит цепочку переименований и обратное переименование', () => {
    let renames = addRename({}, 'Подкормка', 'Удобрение')
    renames = addRename(renames, 'Удобрение', 'Внесение удобрений')
    expect(resolveRename(renames, 'Подкормка')).toBe('Внесение удобрений')
    expect(resolveRename(renames, 'Полив')).toBe('Полив')
    renames = addRename(renames, 'Внесение удобрений', 'Подкормка')
    expect(resolveRename(renames, 'Подкормка')).toBe('Подкормка')
    expect(resolveRename(renames, 'Удобрение')).toBe('Подкормка')
  })

  it('при объединении сохраняет свой порядок и добавляет новые пункты', () => {
    expect(mergeItems(['кг', 'л'], ['Л', 'шт.', 'кг', 'мешок'])).toEqual(['кг', 'л', 'шт.', 'мешок'])
  })

  it('переименование вида работ с телефона заменяет старое имя на планшете и не теряет свой пункт', () => {
    const phone: DictionarySnapshot = {
      updatedAt: '2026-11-02T01:00:00.000Z',
      workKinds: ['Внесение удобрений', 'Полив'],
      workKindRenames: { Подкормка: 'Внесение удобрений' },
      consumableUnits: ['кг'],
      consumableKinds: ['Удобрение'],
      workConditions: ['Как только просохнет почва после таяния снега'],
    }
    const ipad: DictionarySnapshot = {
      updatedAt: '',
      workKinds: ['Подкормка', 'Полив', 'Мульчирование'],
      workKindRenames: {},
      consumableUnits: ['кг', 'л'],
      consumableKinds: [],
      workConditions: [],
    }
    const merged = mergeDictionaries(ipad, phone)
    expect(merged.workKinds).toEqual(['Внесение удобрений', 'Полив', 'Мульчирование'])
    expect(merged.consumableUnits).toEqual(['кг', 'л'])
    expect(merged.consumableKinds).toEqual(['Удобрение'])
    expect(merged.workConditions).toEqual(['Как только просохнет почва после таяния снега'])
  })

  it('пустой справочник другого устройства не стирает свой список', () => {
    const local: DictionarySnapshot = {
      updatedAt: '2026-01-01T00:00:00.000Z',
      workKinds: ['Полив'],
      workKindRenames: {},
      consumableUnits: ['кг'],
      consumableKinds: ['Удобрение'],
      workConditions: ['Как только просохнет почва после таяния снега'],
    }
    const empty: DictionarySnapshot = { updatedAt: '2026-11-02T00:00:00.000Z', workKinds: [], workKindRenames: {}, consumableUnits: [], consumableKinds: [], workConditions: [] }
    expect(mergeDictionaries(local, empty).workKinds).toEqual(['Полив'])
    expect(mergeDictionaries(local, empty).workConditions).toEqual(local.workConditions)
  })
})
