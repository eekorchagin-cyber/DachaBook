import { describe, expect, it } from 'vitest'
import { workTimes } from './applications'

describe('число повторов одной работы', () => {
  it('расписание сезона: каждая неделя с 1 по 22 мая — четыре раза', () => {
    expect(
      workTimes(
        {
          recurrence: 'season',
          periods: [],
          seasonSchedule: { fromMonth: 5, fromDay: 1, toMonth: 5, toDay: 22, everyWeeks: 1 },
        },
        '2026-05-10',
      ),
    ).toBe(4)
  })

  it('ежегодная работа с двумя сроками — два раза, разовая — один', () => {
    expect(workTimes({ recurrence: 'yearly', periods: [{ month: 5 }, { month: 8 }] }, '2026-05-10')).toBe(2)
    expect(workTimes({ recurrence: 'once', periods: [] }, '2026-05-10')).toBe(1)
  })

  it('работа без слов про удобрение всё равно считается по своему расписанию', () => {
    expect(
      workTimes(
        {
          recurrence: 'season',
          periods: [],
          seasonSchedule: { fromMonth: 6, fromDay: 1, toMonth: 6, toDay: 15, everyWeeks: 2 },
        },
        '2026-06-01',
      ),
    ).toBe(2)
  })
})
