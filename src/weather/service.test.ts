import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repo, setSetting } from '../app/store'
import { todayAtSite } from '../domain/dates'
import type { DiaryEvent, DocInput } from '../domain/types'
import { db } from '../storage/db'
import { fillMissingWeather, missingWeatherCount, processWeatherQueue, queueWeather } from './service'

const event = (date: string, time?: string): DocInput<DiaryEvent> => ({ type: 'work', date, time, objectIds: [], plantGroupIds: [], comment: date, photoIds: [], attachmentIds: [] })

/** Ответ Open-Meteo с суточными (и почасовыми) рядами на каждую дату периода. */
function series(start: string, end: string, hourly: boolean) {
  const days: string[] = []
  for (let day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) days.push(day.toISOString().slice(0, 10))
  const hours = hourly ? days.flatMap((day) => Array.from({ length: 24 }, (_, hour) => `${day}T${String(hour).padStart(2, '0')}:00`)) : []
  return {
    daily: {
      time: days,
      weather_code: days.map(() => 61),
      temperature_2m_max: days.map(() => 15),
      temperature_2m_min: days.map(() => 5),
      precipitation_sum: days.map(() => 2),
      wind_speed_10m_max: days.map(() => 4),
      relative_humidity_2m_mean: days.map(() => 70),
    },
    ...(hourly
      ? { hourly: { time: hours, temperature_2m: hours.map(() => 11), relative_humidity_2m: hours.map(() => 60), precipitation: hours.map(() => 0), weather_code: hours.map(() => 0), wind_speed_10m: hours.map(() => 3) } }
      : {}),
  }
}

let requests: string[] = []
let online = true

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  await setSetting('plotLocation', { latitude: 55.75, longitude: 37.62 })
  requests = []
  online = true
  vi.stubGlobal('fetch', async (input: string) => {
    if (!online) throw new TypeError('Load failed')
    const url = new URL(input)
    requests.push(`${url.host} ${url.searchParams.get('start_date') ?? ''}…${url.searchParams.get('end_date') ?? ''}`)
    if (url.host.startsWith('archive')) {
      return new Response(JSON.stringify(series(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!, url.searchParams.has('hourly'))))
    }
    const today = todayAtSite().date
    const start = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10)
    const end = new Date(Date.parse(today) + 6 * 86_400_000).toISOString().slice(0, 10)
    return new Response(JSON.stringify({ ...series(start, end, true), current: { time: `${today}T12:00`, temperature_2m: 8, relative_humidity_2m: 50, precipitation: 0, weather_code: 3, wind_speed_10m: 2 } }))
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('служба погоды', () => {
  it('старые записи получают погоду из архива одним запросом на год', async () => {
    for (const date of ['2021-05-10', '2021-09-01', '2024-06-15', '2024-06-16']) await repo.create('events', event(date))
    await repo.create('events', event('2024-07-01', '09:30'))
    expect(await missingWeatherCount()).toBe(5)

    const result = await fillMissingWeather(() => undefined)
    expect(result).toEqual({ filled: 5, skipped: 0 })
    expect(requests).toEqual(['archive-api.open-meteo.com 2021-05-10…2021-09-01', 'archive-api.open-meteo.com 2024-06-15…2024-07-01'])
    const all = await db.events.toArray()
    expect(all.find((item) => item.date === '2021-05-10')?.weather).toMatchObject({ kind: 'archive', period: 'day', condition: 'rain', airTemperatureMax: 15 })
    expect(all.find((item) => item.time === '09:30')?.weather).toMatchObject({ period: 'hour', airTemperature: 11, condition: 'clear' })
    expect(await missingWeatherCount()).toBe(0)
  })

  it('без связи запись ждёт в очереди и получает погоду, когда связь появляется', async () => {
    const saved = await repo.create('events', event(todayAtSite().date, '10:00'))
    await queueWeather(saved.id)
    online = false
    expect(await processWeatherQueue()).toBe(0)
    expect((await db.events.get(saved.id))?.weather).toBeUndefined()

    online = true
    expect(await processWeatherQueue()).toBe(1)
    expect((await db.events.get(saved.id))?.weather).toMatchObject({ kind: 'forecast', period: 'hour', airTemperature: 11 })
    expect(await processWeatherQueue()).toBe(0)
  })

  it('запись на дату дальше прогноза не получает чужую погоду и ждёт своего срока', async () => {
    const future = new Date(Date.parse(todayAtSite().date) + 30 * 86_400_000).toISOString().slice(0, 10)
    const saved = await repo.create('events', event(future))
    await queueWeather(saved.id)
    expect(await processWeatherQueue()).toBe(0)
    expect((await db.events.get(saved.id))?.weather).toBeUndefined()
    expect(requests).toEqual([])
  })
})
