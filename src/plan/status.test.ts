import { describe, expect, it } from 'vitest'
import type { DiaryEvent, PlanWork } from '../domain/types'
import { addDays, type DailyMinimums } from './frost'
import { periodRange, workHistory, workStatus } from './status'

const work = (extra: Partial<PlanWork>): PlanWork =>
  ({ id: 'w', title: 'Работа', objectIds: [], plantGroupIds: [], recurrence: 'yearly', periods: [], seasons: {}, active: true, ...extra }) as PlanWork
const event = (date: string, comment: string, extra: Partial<DiaryEvent> = {}) => ({ id: date, date, comment, ...extra }) as DiaryEvent

function warm(start: string, end: string): DailyMinimums {
  const time: string[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) time.push(date)
  return { time, temperature_2m_min: time.map(() => 6) }
}

describe('статусы плановых работ', () => {
  it('неделя месяца в датах: 4-я неделя — до конца месяца', () => {
    expect(periodRange({ month: 5, week: 2 }, 2026)).toEqual({ start: '2026-05-08', end: '2026-05-14' })
    expect(periodRange({ month: 9, week: 4 }, 2026)).toEqual({ start: '2026-09-22', end: '2026-09-30' })
    expect(periodRange({ month: 2 }, 2028)).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })

  it('по периоду: запланирована → скоро → готова → срок прошёл', () => {
    const feeding = work({ periods: [{ month: 5, week: 2 }] })
    expect(workStatus(feeding, [], { today: '2026-04-01' }).state).toBe('planned')
    expect(workStatus(feeding, [], { today: '2026-05-01' }).state).toBe('soon')
    expect(workStatus(feeding, [], { today: '2026-05-10' })).toMatchObject({ state: 'ready', date: '2026-05-14' })
    expect(workStatus(feeding, [], { today: '2026-05-20' }).state).toBe('overdue')
  })

  it('выполнение в дневнике этого сезона закрывает работу; прошлогоднее — нет', () => {
    const water = work({ condition: { type: 'beforeAutumnFrost', leadDays: 7 }, historyWords: [['водопровод'], ['слил', 'продул']] })
    const events = [event('2025-09-14', 'Слил водопровод. Продул.'), event('2026-09-12', 'Слил водопровод, продул трубы'), event('2026-09-13', 'Полив газона')]
    const history = workHistory(water, events)
    expect(history).toEqual(['2026-09-12', '2025-09-14'])
    expect(workStatus(water, history, { today: '2026-09-20' })).toMatchObject({ state: 'done', date: '2026-09-12' })
    expect(workStatus(water, ['2025-09-14'], { today: '2026-09-20', forecast: warm('2026-09-13', '2026-09-27') }).state).not.toBe('done')
  })

  it('отметки сезона: выполнена, пропущена, перенесена до даты; следующий год начинается заново', () => {
    const mowing = work({ periods: [{ month: 6 }], seasons: { '2026': { status: 'postponed', date: '2026-07-05' } } })
    expect(workStatus(mowing, [], { today: '2026-07-01' })).toMatchObject({ state: 'postponed', date: '2026-07-05' })
    expect(workStatus(mowing, [], { today: '2026-07-06' }).state).toBe('ready')
    expect(workStatus({ ...mowing, seasons: { '2026': { status: 'skipped' } } }, [], { today: '2026-06-10' }).state).toBe('skipped')
    expect(workStatus({ ...mowing, seasons: { '2026': { status: 'done', date: '2026-06-03' } } }, [], { today: '2027-06-10' }).state).toBe('ready')
  })

  it('монтаж водопровода весной: тёплые ночи — готова, с рекомендуемой субботой', () => {
    const water = work({ condition: { type: 'afterSpringFrost', weekday: 6 } })
    expect(workStatus(water, [], { today: '2026-05-06', forecast: warm('2026-04-29', '2026-05-13') })).toMatchObject({ state: 'ready', date: '2026-05-09' })
  })
})
