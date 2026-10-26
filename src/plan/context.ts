import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { getSetting } from '../app/store'
import { todayAtSite } from '../domain/dates'
import { db } from '../storage/db'
import { fetchDailyMinimums } from '../weather/openMeteo'
import { useForecast } from '../weather/service'
import { frostStats, frostYears, type FrostYear } from './frost'
import type { WorkContext } from './status'

/** Многолетние даты заморозков по архиву для координат участка; хранятся на устройстве, обновляются раз в год. */
interface StoredClimate {
  latitude: number
  longitude: number
  fromYear: number
  toYear: number
  years: FrostYear[]
  computedAt: string
}

const CLIMATE_KEY = 'frostClimate'
export const CLIMATE_YEARS = 10

let loading: Promise<StoredClimate | null> | null = null

export function refreshClimate(): Promise<StoredClimate | null> {
  loading ??= (async () => {
    const location = await getSetting('plotLocation')
    if (!location) return null
    const toYear = Number(todayAtSite().date.slice(0, 4)) - 1
    const cached = (await db.settings.get(CLIMATE_KEY))?.value as StoredClimate | undefined
    if (cached && cached.latitude === location.latitude && cached.longitude === location.longitude && cached.toYear === toYear) return cached
    const fromYear = toYear - CLIMATE_YEARS + 1
    const daily = await fetchDailyMinimums(location, `${fromYear}-01-01`, `${toYear}-12-31`)
    const climate: StoredClimate = { ...location, fromYear, toYear, years: frostYears(daily), computedAt: new Date().toISOString() }
    await db.settings.put({ key: CLIMATE_KEY, value: climate })
    return climate
  })().finally(() => {
    loading = null
  })
  return loading
}

/** Всё, что нужно для статусов работ: сегодня, прогноз минимумов (неделя назад и вперёд), многолетние заморозки. */
export function useWorkContext(): WorkContext & { climateYears?: FrostYear[]; climateRange?: string } {
  const { forecast, location } = useForecast()
  const climate = useLiveQuery(async () => (await db.settings.get(CLIMATE_KEY))?.value as StoredClimate | undefined, [])
  const hasLocation = !!location
  useEffect(() => {
    if (hasLocation) void refreshClimate().catch(() => undefined)
  }, [hasLocation])
  const matches = climate && location && climate.latitude === location.latitude && climate.longitude === location.longitude
  return {
    today: todayAtSite().date,
    forecast: forecast?.daily ? { time: forecast.daily.time, temperature_2m_min: forecast.daily.temperature_2m_min } : undefined,
    climate: matches ? frostStats(climate.years) : undefined,
    climateYears: matches ? climate.years : undefined,
    climateRange: matches ? `${climate.fromYear}–${climate.toYear}` : undefined,
  }
}
