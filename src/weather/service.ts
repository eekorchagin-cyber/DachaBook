import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { getSetting, repo } from '../app/store'
import { todayAtSite } from '../domain/dates'
import type { PlotLocation } from '../domain/location'
import type { DiaryEvent } from '../domain/types'
import { errorText } from '../lib/format'
import { db } from '../storage/db'
import { fetchArchive, fetchForecast, type Forecast, type WeatherSeries } from './openMeteo'
import { needsWeather, snapshotFromSeries, weatherSourceFor } from './snapshot'

/** Прогноз и очередь хранятся только на этом устройстве (настройки устройства не синхронизируются). */
const CACHE_KEY = 'weatherForecast'
const QUEUE_KEY = 'weatherQueue'
const FRESH_MS = 30 * 60 * 1000

const sameLocation = (forecast: Forecast, location: PlotLocation) => forecast.latitude === location.latitude && forecast.longitude === location.longitude

async function cachedForecast(): Promise<Forecast | undefined> {
  return (await db.settings.get(CACHE_KEY))?.value as Forecast | undefined
}

/** Прогноз участка: свежий из кэша (до 30 минут) или с сервера. Без координат — null. */
export async function refreshForecast(force = false): Promise<Forecast | null> {
  const location = await getSetting('plotLocation')
  if (!location) return null
  const cached = await cachedForecast()
  if (!force && cached && sameLocation(cached, location) && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) return cached
  const fresh = await fetchForecast(location)
  await db.settings.put({ key: CACHE_KEY, value: fresh })
  return fresh
}

export function useForecast(): { forecast?: Forecast; location?: PlotLocation | null; error?: string; loading: boolean; refresh: () => void } {
  const data = useLiveQuery(async () => ({ forecast: await cachedForecast(), location: await getSetting('plotLocation') }), [])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const load = useCallback(
    (force: boolean) =>
      refreshForecast(force)
        .then(() => setError(undefined))
        .catch((caught) => setError(errorText(caught))),
    [],
  )
  const refresh = useCallback(() => {
    setLoading(true)
    void load(true).finally(() => setLoading(false))
  }, [load])
  const hasLocation = !!data?.location
  useEffect(() => {
    if (!hasLocation) return
    void load(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [hasLocation, load])
  return { forecast: data?.forecast && data.location && sameLocation(data.forecast, data.location) ? data.forecast : undefined, location: data?.location, error, loading, refresh }
}

async function readQueue(): Promise<string[]> {
  return ((await db.settings.get(QUEUE_KEY))?.value as string[] | undefined) ?? []
}

/** Запись, сохранённая на этом устройстве, ждёт погоду (сразу или когда появится связь). */
export async function queueWeather(eventId: string): Promise<void> {
  const queue = await readQueue()
  if (!queue.includes(eventId)) await db.settings.put({ key: QUEUE_KEY, value: [...queue, eventId] })
}

const archiveCache = new Map<string, WeatherSeries>()

async function seriesFor(location: PlotLocation, event: DiaryEvent, source: 'forecast' | 'archive'): Promise<{ series: WeatherSeries; fetchedAt: string }> {
  if (source === 'forecast') {
    const forecast = await refreshForecast()
    if (!forecast) throw new Error('не заданы координаты участка')
    return { series: forecast, fetchedAt: forecast.fetchedAt }
  }
  const key = `${location.latitude},${location.longitude},${event.date},${!!event.time}`
  let series = archiveCache.get(key)
  if (!series) {
    series = await fetchArchive(location, event.date, event.date, !!event.time)
    archiveCache.set(key, series)
  }
  return { series, fetchedAt: new Date().toISOString() }
}

let processing = false

/** Подставляет погоду записям из очереди. Нет связи — очередь ждёт; даты дальше прогноза ждут своего срока. */
export async function processWeatherQueue(): Promise<number> {
  if (processing) return 0
  processing = true
  let filled = 0
  try {
    const location = await getSetting('plotLocation')
    if (!location) return 0
    const today = todayAtSite().date
    for (const id of await readQueue()) {
      const event = await db.events.get(id)
      const done = async () => db.settings.put({ key: QUEUE_KEY, value: (await readQueue()).filter((item) => item !== id) })
      if (!event || event.deletedAt || !needsWeather(event)) {
        await done()
        continue
      }
      const source = weatherSourceFor(event.date, today)
      if (!source) continue
      const { series, fetchedAt } = await seriesFor(location, event, source)
      const snapshot = snapshotFromSeries(series, location, { date: event.date, time: event.time }, event.date < today ? 'archive' : 'forecast', fetchedAt)
      if (!snapshot) continue
      const latest = await db.events.get(id)
      if (!latest || !needsWeather(latest) || latest.date !== event.date || latest.time !== event.time) continue
      await repo.update('events', id, { weather: snapshot }, latest.revision)
      await done()
      filled++
    }
  } catch {
    // Нет связи или сервис недоступен: очередь сохранится и обработается позже.
  } finally {
    processing = false
  }
  return filled
}

/** Обработка очереди при запуске, появлении сети и возврате в приложение. */
export function startWeather(): void {
  const run = () => void processWeatherQueue()
  setTimeout(run, 3000)
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run()
  })
}

export async function missingWeatherCount(): Promise<number> {
  const today = todayAtSite().date
  return db.events.filter((event) => !event.deletedAt && needsWeather(event) && weatherSourceFor(event.date, today) !== null).count()
}

/**
 * Погода для старых записей (например, импортированных из Evernote): архив одним запросом на год.
 * Запускается вручную на одном устройстве — иначе каждое устройство изменило бы одни и те же записи.
 */
export async function fillMissingWeather(onProgress: (text: string) => void): Promise<{ filled: number; skipped: number }> {
  const location = await getSetting('plotLocation')
  if (!location) throw new Error('Сначала укажите координаты участка в настройках')
  const today = todayAtSite().date
  const events = (await db.events.toArray()).filter((event) => !event.deletedAt && needsWeather(event) && weatherSourceFor(event.date, today) !== null)
  const groups = new Map<string, DiaryEvent[]>()
  for (const event of events) {
    const key = weatherSourceFor(event.date, today) === 'forecast' ? 'forecast' : event.date.slice(0, 4)
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  let filled = 0
  let skipped = 0
  for (const [key, group] of [...groups.entries()].sort()) {
    onProgress(key === 'forecast' ? 'Последняя неделя…' : `${key} год…`)
    const dates = group.map((event) => event.date).sort()
    const series: WeatherSeries = key === 'forecast' ? ((await refreshForecast()) ?? {}) : await fetchArchive(location, dates[0], dates.at(-1)!, group.some((event) => !!event.time))
    const fetchedAt = new Date().toISOString()
    for (const event of group) {
      const snapshot = snapshotFromSeries(series, location, { date: event.date, time: event.time }, event.date < today ? 'archive' : 'forecast', fetchedAt)
      const latest = await db.events.get(event.id)
      if (!snapshot || !latest || !needsWeather(latest)) {
        skipped++
        continue
      }
      await repo.update('events', event.id, { weather: snapshot }, latest.revision)
      filled++
    }
  }
  return { filled, skipped }
}
