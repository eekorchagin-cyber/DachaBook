import { describe, expect, it } from 'vitest'
import { splitCardWorks } from './workGroups'

describe('работы в карточке объекта', () => {
  const works = [
    { id: 'plan', title: 'Полив', active: true },
    { id: 'done', title: 'Обрезка', active: true },
    { id: 'archive', title: 'Укрытие', active: false },
  ]

  it('отделяет запланированные от выполненных и архива', () => {
    expect(splitCardWorks(works, new Set(['done']))).toEqual({
      planned: [works[0]],
      done: [works[1]],
      archived: [works[2]],
    })
  })

  it('работа без отметки остаётся в запланированных', () => {
    expect(splitCardWorks(works, new Set()).planned.map((work) => work.id)).toEqual(['plan', 'done'])
  })
})
