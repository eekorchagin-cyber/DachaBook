import { describe, expect, it } from 'vitest'
import { planAlreadyHas, planInputFromEvent, weekOfMonth } from './fromEvent'

describe('работа плана из записи дневника', () => {
  it('берёт название, срок этой недели, объекты, группы и материалы и отмечает год выполненным', () => {
    expect(weekOfMonth('2026-11-20')).toBe(3)
    expect(weekOfMonth('2026-11-29')).toBe(4)
    expect(
      planInputFromEvent({
        id: 'e1',
        date: '2026-11-20',
        comment: 'Побелил яблони. Завтра доделать забор.',
        workKind: 'Побелка',
        objectIds: ['garden'],
        plantGroupIds: ['apple'],
        consumables: [{ consumableId: 'lime', quantity: 1 }],
      }),
    ).toMatchObject({
      title: 'Побелил яблони.',
      workKind: 'Побелка',
      objectIds: ['garden'],
      plantGroupIds: ['apple'],
      recurrence: 'yearly',
      periods: [{ month: 11, week: 3 }],
      consumableIds: ['lime'],
      seasons: { '2026': { status: 'done', date: '2026-11-20', eventId: 'e1' } },
      active: true,
    })
  })

  it('без текста записи карточку не предлагает', () => {
    expect(planInputFromEvent({ id: 'e', date: '2026-05-02', comment: '   ', objectIds: [], plantGroupIds: [] })).toBeUndefined()
  })

  it('не предлагает работу, которая уже есть в плане под тем же названием', () => {
    const works = [
      { title: 'Побелил яблони.', active: true },
      { title: 'Снятая', active: false },
      { title: 'Удалённая', active: true, deletedAt: '2026-01-01' },
    ]
    expect(planAlreadyHas(works, 'побелил  яблони.')).toBe(true)
    expect(planAlreadyHas(works, 'Снятая')).toBe(false)
    expect(planAlreadyHas(works, 'Удалённая')).toBe(false)
  })
})
