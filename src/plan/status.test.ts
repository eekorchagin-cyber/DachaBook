import { describe, expect, it } from 'vitest'
import type { DiaryEvent, PlanWork } from '../domain/types'
import { addDays, type DailyMinimums } from './frost'
import { isUpcoming, periodRange, seasonOccurrences, seasonStartYear, workHistory, workStatus } from './status'

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

  it('раз в две недели: срок, просрочка, отметка закрывает только этот раз', () => {
    const feeding = work({
      recurrence: 'season',
      seasonSchedule: { fromMonth: 6, fromDay: 10, toMonth: 9, toDay: 10, everyWeeks: 2 },
    })
    expect(workStatus(feeding, [], { today: '2026-06-01' })).toMatchObject({ state: 'soon', date: '2026-06-10' })
    expect(workStatus(feeding, [], { today: '2026-06-10' }).state).toBe('ready')
    expect(workStatus(feeding, [], { today: '2026-06-12' }).state).toBe('overdue')
    expect(workStatus({ ...feeding, doneDates: ['2026-06-12'] }, [], { today: '2026-06-13' })).toMatchObject({ state: 'soon', date: '2026-06-24' })
    expect(workStatus({ ...feeding, doneDates: ['2026-06-12'] }, [], { today: '2026-06-24' }).state).toBe('ready')
    expect(workStatus({ ...feeding, doneDates: ['2026-06-12'] }, [], { today: '2027-06-10' }).state).toBe('ready')
  })

  it('дни недели: сегодня закрывается отметкой, следующий день недели остаётся', () => {
    const watering = work({
      recurrence: 'season',
      seasonSchedule: { fromMonth: 5, fromDay: 10, toMonth: 9, toDay: 5, weekdays: [1, 3, 5], timeFrom: '07:00', timeTo: '07:20' },
    })
    expect(workStatus(watering, [], { today: '2026-05-11' })).toMatchObject({ state: 'ready', message: 'сегодня, 07:00–07:20' })
    expect(workStatus({ ...watering, doneDates: ['2026-05-11'] }, [], { today: '2026-05-11' })).toMatchObject({ state: 'soon', date: '2026-05-13' })
    expect(workStatus(watering, ['2026-05-11'], { today: '2026-05-12' })).toMatchObject({ state: 'soon', date: '2026-05-13' })
  })

  it('однократная работа после выполнения не возвращается в следующем году', () => {
    const once = work({ recurrence: 'once', periods: [{ month: 6 }], seasons: { '2025': { status: 'done', date: '2025-06-02' } } })
    expect(workStatus(once, [], { today: '2026-06-10' })).toMatchObject({ state: 'done', closed: true })
    expect(workStatus({ ...once, seasons: {} }, [], { today: '2026-06-10' }).state).toBe('ready')
  })

  it('снежный сезон ноябрь–март заканчивается в следующем календарном году', () => {
    const snow = work({
      recurrence: 'season',
      seasonSchedule: { fromMonth: 11, fromDay: 1, toMonth: 3, toDay: 31, everyWeeks: 1 },
    })
    const dates = seasonOccurrences(snow.seasonSchedule!, 2025)
    expect(dates[0]).toBe('2025-11-01')
    expect(dates.at(-1)).toBe('2026-03-28')
    expect(dates.some((date) => date.startsWith('2026-01'))).toBe(true)
    expect(seasonStartYear(snow.seasonSchedule!, '2026-01-15')).toBe(2025)
    expect(seasonStartYear(snow.seasonSchedule!, '2026-04-10')).toBe(2026)
    expect(['overdue', 'ready', 'soon']).toContain(workStatus(snow, [], { today: '2026-01-15' }).state)
    expect(workStatus(snow, [], { today: '2026-04-10' }).state).toBe('planned')
    expect(workStatus({ ...snow, seasons: { '2025': { status: 'skipped' } } }, [], { today: '2026-01-15' }).state).toBe('skipped')
  })

  it('уборка снега через два дня попадает в ближайшие работы на главной', () => {
    const snow = work({
      recurrence: 'season',
      seasonSchedule: { fromMonth: 10, fromDay: 31, toMonth: 3, toDay: 31, everyWeeks: 1 },
    })
    const status = workStatus(snow, [], { today: '2026-10-29' })
    expect(status).toMatchObject({ state: 'soon', date: '2026-10-31' })
    expect(isUpcoming(status)).toBe(true)
  })

  it('монтаж водопровода весной: тёплые ночи — готова, с рекомендуемой субботой', () => {
    const water = work({ condition: { type: 'afterSpringFrost', weekday: 6 } })
    expect(workStatus(water, [], { today: '2026-05-06', forecast: warm('2026-04-29', '2026-05-13') })).toMatchObject({ state: 'ready', date: '2026-05-09' })
  })
})
