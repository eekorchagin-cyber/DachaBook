import { describe, expect, it } from 'vitest'
import type { DiaryEvent, WateringZone } from '../domain/types'
import { inWateringSeason, isWateringUpcoming, nextWateringDay, rainMm, wateringHistory, wateringStatus } from './status'

const zone = (extra: Partial<WateringZone> = {}): WateringZone =>
  ({
    id: 'z',
    name: 'Газон',
    kind: 'sprinkler',
    objectIds: ['lawn'],
    plantGroupIds: [],
    weekdays: [1, 4],
    durationMin: 20,
    fromMonth: 5,
    fromDay: 1,
    toMonth: 9,
    toDay: 30,
    skipRainMm: 5,
    skippedDates: [],
    active: true,
    ...extra,
  }) as WateringZone

describe('полив зон', () => {
  it('понедельник в сезоне — пора поливать, четверг — скоро', () => {
    const lawn = zone()
    expect(wateringStatus(lawn, [], { today: '2026-06-15', precipitation: {} })).toMatchObject({ state: 'ready', date: '2026-06-15' })
    expect(wateringStatus(lawn, [], { today: '2026-06-16', precipitation: {} })).toMatchObject({ state: 'soon', date: '2026-06-18' })
    expect(isWateringUpcoming(wateringStatus(lawn, [], { today: '2026-06-16', precipitation: {} }))).toBe(true)
  })

  it('дождь вчера и сегодня не меньше порога — полив можно пропустить', () => {
    const lawn = zone()
    const wet = wateringStatus(lawn, [], { today: '2026-06-15', precipitation: { '2026-06-14': 3, '2026-06-15': 3 } })
    expect(wet).toMatchObject({ state: 'rain', rainMm: 6 })
    expect(rainMm({ today: '2026-06-15', precipitation: { '2026-06-14': 3, '2026-06-15': 3 } })).toBe(6)
    expect(wateringStatus(lawn, [], { today: '2026-06-15', precipitation: { '2026-06-15': 4 } }).state).toBe('ready')
  })

  it('запись дневника на сегодня закрывает зону; пропуск — только этот день', () => {
    const lawn = zone()
    expect(wateringStatus(lawn, ['2026-06-15'], { today: '2026-06-15', precipitation: {} }).state).toBe('done')
    expect(wateringStatus({ ...lawn, skippedDates: ['2026-06-15'] }, [], { today: '2026-06-15', precipitation: {} }).state).toBe('skipped')
    expect(wateringStatus({ ...lawn, skippedDates: ['2026-06-15'] }, [], { today: '2026-06-18', precipitation: {} }).state).toBe('ready')
  })

  it('вне сезона октябрь — не поливаем, май уже скоро в апреле', () => {
    const lawn = zone()
    expect(inWateringSeason(lawn, '2026-10-30')).toBe(false)
    expect(wateringStatus(lawn, [], { today: '2026-10-30', precipitation: {} }).state).toBe('off')
    expect(wateringStatus(lawn, [], { today: '2026-04-25', precipitation: {} })).toMatchObject({ state: 'soon', date: '2026-05-04' })
    expect(nextWateringDay(lawn, '2026-04-25')).toBe('2026-05-04')
  })

  it('история зоны — полив её объектов, чужой полив не считается', () => {
    const lawn = zone()
    const events = [
      { id: 'a', type: 'work', date: '2026-06-15', workKind: 'Полив', objectIds: ['lawn'], comment: 'полил', deletedAt: undefined },
      { id: 'b', type: 'work', date: '2026-06-16', workKind: 'Полив', objectIds: ['beds'], comment: 'грядки', deletedAt: undefined },
      { id: 'c', type: 'work', date: '2026-06-11', workKind: 'Стрижка газона', objectIds: ['lawn'], comment: 'Полив: Газон', deletedAt: undefined },
      { id: 'd', type: 'work', date: '2026-06-15', workKind: 'Полив', objectIds: ['lawn'], comment: 'ещё раз', deletedAt: undefined },
    ] as DiaryEvent[]
    expect(wateringHistory(lawn, events)).toEqual(['2026-06-15', '2026-06-11'])
  })

  it('дождь накануне дня полива — можно пропустить завтрашний раз', () => {
    const lawn = zone()
    expect(wateringStatus(lawn, [], { today: '2026-06-17', precipitation: { '2026-06-16': 4, '2026-06-17': 2 } })).toMatchObject({
      state: 'rain',
      date: '2026-06-18',
    })
  })

  it('сезон через Новый год считается в следующем календарном году', () => {
    const winter = zone({ fromMonth: 11, fromDay: 1, toMonth: 3, toDay: 31, weekdays: [6] })
    expect(inWateringSeason(winter, '2026-12-05')).toBe(true)
    expect(inWateringSeason(winter, '2027-02-01')).toBe(true)
    expect(inWateringSeason(winter, '2026-06-01')).toBe(false)
    expect(wateringStatus(winter, [], { today: '2026-12-05', precipitation: {} }).state).toBe('ready')
    expect(nextWateringDay(winter, '2026-10-30')).toBe('2026-11-07')
    expect(wateringStatus(winter, [], { today: '2026-10-30', precipitation: {} })).toMatchObject({ state: 'soon', date: '2026-11-07' })
  })
})
