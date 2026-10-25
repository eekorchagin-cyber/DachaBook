import { describe, expect, it } from 'vitest'
import { addRename, itemProblem, mergeItems, moveItem, resolveRename } from './dictionaries'

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
})
