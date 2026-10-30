import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DiaryDatabase } from '../storage/db'
import { Repository } from '../storage/repository'
import { seedWateringZones } from './seed'

describe('стартовые зоны полива', () => {
  it('создаёт газон, сад и грядки один раз и привязывает к объектам', async () => {
    const database = new DiaryDatabase(`seed-water-${crypto.randomUUID()}`)
    const repo = new Repository(database, () => 'Егор')
    const lawn = await repo.create('objects', { name: 'Газон', type: 'lawn', active: true })
    await repo.create('objects', { name: 'Сад', type: 'garden', active: true })
    await repo.create('objects', { name: 'Грядки', type: 'beds', active: true })

    expect(await seedWateringZones(database)).toBe(3)
    expect(await seedWateringZones(database)).toBe(0)

    const zones = (await database.wateringZones.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    expect(zones.map((zone) => zone.name)).toEqual(['Газон', 'Грядки', 'Сад'])
    expect(zones[0]).toMatchObject({ kind: 'sprinkler', weekdays: [2, 5], durationMin: 20, skipRainMm: 5, objectIds: [lawn.id] })
    expect(zones.find((zone) => zone.name === 'Сад')?.kind).toBe('drip')
    expect(zones.find((zone) => zone.name === 'Грядки')?.weekdays).toEqual([1, 3, 5])
  })
})
