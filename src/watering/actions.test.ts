import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { repo } from '../app/store'
import { db } from '../storage/db'
import { skipWateringToday, undoWateringSkip } from './actions'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('пропуск полива', () => {
  it('пропуск только сегодня, повтор не дублирует дату, отмена снимает её', async () => {
    const zone = await repo.create('wateringZones', {
      name: 'Газон',
      kind: 'sprinkler',
      objectIds: [],
      plantGroupIds: [],
      weekdays: [1, 4],
      durationMin: 20,
      fromMonth: 5,
      fromDay: 1,
      toMonth: 9,
      toDay: 30,
      skipRainMm: 5,
      active: true,
    })
    await skipWateringToday(zone.id, '2026-06-15')
    await skipWateringToday(zone.id, '2026-06-15')
    expect((await db.wateringZones.get(zone.id))?.skippedDates).toEqual(['2026-06-15'])
    await undoWateringSkip(zone.id, '2026-06-15')
    expect((await db.wateringZones.get(zone.id))?.skippedDates).toEqual([])
  })
})
