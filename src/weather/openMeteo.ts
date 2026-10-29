import { SITE_TIME_ZONE } from '../domain/dates'
import type { PlotLocation } from '../domain/location'
import type { WeatherCondition } from '../domain/types'

/** Почасовые и суточные ряды в местном времени участка (ответ Open-Meteo с timezone участка). */
export interface WeatherSeries {
  hourly?: {
    time: string[]
    temperature_2m: (number | null)[]
    relative_humidity_2m: (number | null)[]
    precipitation: (number | null)[]
    weather_code: (number | null)[]
    wind_speed_10m: (number | null)[]
  }
  daily?: {
    time: string[]
    weather_code: (number | null)[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
    precipitation_sum: (number | null)[]
    wind_speed_10m_max: (number | null)[]
    relative_humidity_2m_mean?: (number | null)[]
  }
}

export interface Forecast extends WeatherSeries {
  latitude: number
  longitude: number
  fetchedAt: string
  current?: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    precipitation: number
    weather_code: number
    wind_speed_10m: number
  }
}

export const WEATHER_SOURCE = 'Open-Meteo'
const HOURLY = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m'
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean'
/** Сколько дней назад покрывает прогноз; старше — архив (он появляется с задержкой в несколько дней). */
export const FORECAST_PAST_DAYS = 7
export const FORECAST_DAYS = 7

async function get<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new Error('Нет связи с сервисом погоды Open-Meteo. Если зарубежные сайты недоступны, включите VPN.')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { reason?: string }
    throw new Error(`Сервис погоды ответил ошибкой ${response.status}${body.reason ? `: ${body.reason}` : ''}`)
  }
  return (await response.json()) as T
}

const common = (location: PlotLocation) => ({
  latitude: String(location.latitude),
  longitude: String(location.longitude),
  timezone: SITE_TIME_ZONE,
  wind_speed_unit: 'ms',
})

export async function fetchForecast(location: PlotLocation): Promise<Forecast> {
  const params = new URLSearchParams({
    ...common(location),
    current: HOURLY,
    hourly: HOURLY,
    daily: DAILY,
    past_days: String(FORECAST_PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  })
  const data = await get<Omit<Forecast, 'fetchedAt'>>(`https://api.open-meteo.com/v1/forecast?${params}`)
  return { ...data, latitude: location.latitude, longitude: location.longitude, fetchedAt: new Date().toISOString() }
}

/** Архив за период ГГГГ-ММ-ДД…ГГГГ-ММ-ДД: суточные данные, почасовые — по запросу. */
export async function fetchArchive(location: PlotLocation, start: string, end: string, hourly: boolean): Promise<WeatherSeries> {
  const params = new URLSearchParams({ ...common(location), start_date: start, end_date: end, daily: DAILY, ...(hourly ? { hourly: HOURLY } : {}) })
  return get<WeatherSeries>(`https://archive-api.open-meteo.com/v1/archive?${params}`)
}

/** Код погоды ВМО → значок записи: солнце, облачно, дождь, снег, гроза. */
export function conditionFromCode(code: number | null | undefined): WeatherCondition | undefined {
  if (code === null || code === undefined) return undefined
  if (code <= 1) return 'clear'
  if (code <= 48) return 'cloudy'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunderstorm'
  return 'rain'
}

/** Суточные минимумы за много лет (многолетние даты заморозков): один лёгкий запрос. */
export async function fetchDailyMinimums(location: PlotLocation, start: string, end: string): Promise<{ time: string[]; temperature_2m_min: (number | null)[] }> {
  const params = new URLSearchParams({ ...common(location), start_date: start, end_date: end, daily: 'temperature_2m_min' })
  const data = await get<{ daily: { time: string[]; temperature_2m_min: (number | null)[] } }>(`https://archive-api.open-meteo.com/v1/archive?${params}`)
  return data.daily
}
