import { describe, expect, it } from 'vitest'
import { objectDeleteBlockers } from './objectLinks'

describe('удаление объекта', () => {
  it('разрешает удаление без связей', () => {
    expect(
      objectDeleteBlockers({
        objectId: 'o1',
        events: [],
        works: [],
        zones: [],
        groups: [],
        object: { photoIds: [] },
      }),
    ).toEqual([])
  })

  it('перечисляет связи', () => {
    expect(
      objectDeleteBlockers({
        objectId: 'o1',
        events: [{ objectIds: ['o1'], deletedAt: undefined }],
        works: [{ objectIds: ['o1'], deletedAt: undefined }],
        zones: [],
        groups: [{ objectIds: ['o1', 'o2'], deletedAt: undefined }],
        object: { photoIds: ['p1'] },
      }),
    ).toEqual(['есть записи дневника', 'есть плановые работы', 'есть группы растений', 'есть фотографии'])
  })

  it('игнорирует удалённые в корзину связи', () => {
    expect(
      objectDeleteBlockers({
        objectId: 'o1',
        events: [{ objectIds: ['o1'], deletedAt: '2026-01-01' }],
        works: [],
        zones: [],
        groups: [],
        object: {},
      }),
    ).toEqual([])
  })
})
