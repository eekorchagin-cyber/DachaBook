import { getSetting } from '../app/store'
import { todayAtSite } from '../domain/dates'
import type { YearClimate } from '../domain/monthlyClimate'
import { monthlyClimate } from '../domain/monthlyClimate'
import type { PlotLocation } from '../domain/location'
import { db } from '../storage/db'
import { fetchArchive } from './openMeteo'

/** Сколько полных лет держать в графике климата. */
export const MONTHLY_CLIMATE_YEARS = 5
const CLIMATE_KEY = 'monthlyClimate'

export interface StoredMonthlyClimate {
  latitude: number
  longitude: number
  fromYear: number
  toYear: number
  years: YearClimate[]
  computedAt: string
}

let loading: Promise<StoredMonthlyClimate | null> | null = null

/** Архив температуры и осадков по месяцам для координат участка; на устройстве, обновляется раз в год. */
export function refreshMonthlyClimate(): Promise<StoredMonthlyClimate | null> {
  loading ??= (async () => {
    const location = await getSetting('plotLocation')
    if (!location) return null
    const toYear = Number(todayAtSite().date.slice(0, 4)) - 1
    const cached = (await db.settings.get(CLIMATE_KEY))?.value as StoredMonthlyClimate | undefined
    if (cached && cached.latitude === location.latitude && cached.longitude === location.longitude && cached.toYear === toYear) return cached
    const fromYear = toYear - MONTHLY_CLIMATE_YEARS + 1
    const archive = await fetchArchive(location, `${fromYear}-01-01`, `${toYear}-12-31`, false)
    const daily = archive.daily
    if (!daily?.time?.length) throw new Error('Сервис погоды не вернул суточные данные за выбранные годы')
    const stored: StoredMonthlyClimate = {
      latitude: location.latitude,
      longitude: location.longitude,
      fromYear,
      toYear,
      years: monthlyClimate({
        time: daily.time,
        temperature_2m_max: daily.temperature_2m_max,
        temperature_2m_min: daily.temperature_2m_min,
        precipitation_sum: daily.precipitation_sum,
      }),
      computedAt: new Date().toISOString(),
    }
    await db.settings.put({ key: CLIMATE_KEY, value: stored })
    return stored
  })().finally(() => {
    loading = null
  })
  return loading
}

export async function readMonthlyClimate(location: PlotLocation | null | undefined): Promise<StoredMonthlyClimate | undefined> {
  if (!location) return undefined
  const cached = (await db.settings.get(CLIMATE_KEY))?.value as StoredMonthlyClimate | undefined
  if (!cached) return undefined
  if (cached.latitude !== location.latitude || cached.longitude !== location.longitude) return undefined
  return cached
}
