import { describe, expect, it } from 'vitest'
import { applicationHint, applicationWorks, plannedTimes } from './applications'
import type { PlanWork } from './types'

function work(patch: Partial<PlanWork> & Pick<PlanWork, 'id' | 'title'>): PlanWork {
  return {
    schemaVersion: 1,
    revision: 'r',
    createdAt: '',
    updatedAt: '',
    createdBy: '',
    updatedBy: '',
    checksum: '',
    objectIds: ['lawn'],
    plantGroupIds: [],
    recurrence: 'yearly',
    periods: [{ month: 5 }],
    seasons: {},
    active: true,
    ...patch,
  }
}

describe('кратность внесения из плана работ', () => {
  const today = '2026-05-10'

  it('считает повторы подкормки по расписанию и не берёт стрижку и чужой объект', () => {
    const feeding = work({
      id: 'feed',
      title: 'Подкормка газона',
      workKind: 'Подкормка',
      recurrence: 'season',
      periods: [],
      seasonSchedule: { fromMonth: 5, fromDay: 1, toMonth: 5, toDay: 22, everyWeeks: 1 },
    })
    const mowing = work({ id: 'mow', title: 'Стрижка газона', workKind: 'Стрижка газона', recurrence: 'season', seasonSchedule: feeding.seasonSchedule })
    const beds = work({ id: 'beds', title: 'Обработка грядок', workKind: 'Обработка от вредителей и болезней', objectIds: ['beds'], periods: [{ month: 6 }, { month: 7 }] })
    const archived = work({ id: 'old', title: 'Подкормка', deletedAt: '2026-01-01' })
    const matched = applicationWorks([feeding, mowing, beds, archived], ['lawn'], today)
    expect(matched).toEqual([{ id: 'feed', title: 'Подкормка газона', times: 4 }])
    expect(plannedTimes(matched)).toBe(4)
    expect(applicationHint(matched)).toBe('Из плана работ: Подкормка газона — 4.')
  })

  it('ежегодная работа с двумя сроками — два внесения, разовая — одно', () => {
    const yearly = work({ id: 'year', title: 'Внести удобрение', periods: [{ month: 5 }, { month: 8 }] })
    const once = work({ id: 'once', title: 'Посев сидератов', recurrence: 'once', periods: [], objectIds: ['lawn'] })
    const matched = applicationWorks([yearly, once], ['lawn'], today)
    expect(plannedTimes(matched)).toBe(3)
  })

  it('без выбранных объектов план не подставляется', () => {
    const feeding = work({ id: 'feed', title: 'Подкормка' })
    expect(applicationWorks([feeding], [], today)).toEqual([])
    expect(applicationHint([])).toContain('нет подкормок')
  })
})
