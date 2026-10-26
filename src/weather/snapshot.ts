import type { PlotLocation } from '../domain/location'
import type { WeatherSnapshot } from '../domain/types'
import { conditionFromCode, FORECAST_DAYS, FORECAST_PAST_DAYS, WEATHER_SOURCE, type WeatherSeries } from './openMeteo'

const round1 = (value: number | null | undefined) => (value === null || value === undefined ? undefined : Math.round(value * 10) / 10)

/**
 * Погода на момент записи: за час, если время указано и есть почасовые данные, иначе суточная сводка.
 * Нет данных на эту дату (будущее за пределами прогноза, архив ещё не готов) — null, а не текущая погода.
 */
export function snapshotFromSeries(
  series: WeatherSeries,
  location: PlotLocation,
  target: { date: string; time?: string },
  kind: 'forecast' | 'archive',
  fetchedAt: string,
): WeatherSnapshot | null {
  const base = { source: WEATHER_SOURCE, kind, latitude: location.latitude, longitude: location.longitude, fetchedAt, forDate: target.date, forTime: target.time }
  if (target.time && series.hourly) {
    const index = series.hourly.time.indexOf(`${target.date}T${target.time.slice(0, 2)}:00`)
    const temperature = index >= 0 ? series.hourly.temperature_2m[index] : null
    if (index >= 0 && temperature !== null && temperature !== undefined) {
      return {
        ...base,
        period: 'hour',
        condition: conditionFromCode(series.hourly.weather_code[index]),
        airTemperature: round1(temperature),
        precipitationMm: round1(series.hourly.precipitation[index]),
        humidityPercent: round1(series.hourly.relative_humidity_2m[index]),
        windMs: round1(series.hourly.wind_speed_10m[index]),
      }
    }
  }
  if (!series.daily) return null
  const index = series.daily.time.indexOf(target.date)
  const max = index >= 0 ? series.daily.temperature_2m_max[index] : null
  if (index < 0 || max === null || max === undefined) return null
  return {
    ...base,
    period: 'day',
    condition: conditionFromCode(series.daily.weather_code[index]),
    airTemperatureMin: round1(series.daily.temperature_2m_min[index]),
    airTemperatureMax: round1(max),
    precipitationMm: round1(series.daily.precipitation_sum[index]),
    humidityPercent: round1(series.daily.relative_humidity_2m_mean?.[index]),
    windMs: round1(series.daily.wind_speed_10m_max[index]),
  }
}

const dayMs = 24 * 60 * 60 * 1000
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs)

/** Откуда брать погоду для даты: прогноз (неделя назад — неделя вперёд), архив (раньше) или нигде (дальше прогноза). */
export function weatherSourceFor(date: string, today: string): 'forecast' | 'archive' | null {
  const offset = daysBetween(today, date)
  if (offset > FORECAST_DAYS - 1) return null
  return offset >= -FORECAST_PAST_DAYS + 1 ? 'forecast' : 'archive'
}

/** Снимок устарел для записи: изменились дата или время, или его ещё нет. */
export function needsWeather(event: { date: string; time?: string; weather?: WeatherSnapshot }): boolean {
  if (!event.weather) return true
  if (event.weather.kind === 'manual') return false
  return event.weather.forDate !== undefined && (event.weather.forDate !== event.date || (event.weather.forTime ?? '') !== (event.time ?? ''))
}

/** Прошедшие дни берутся из модели, а не из измерений: так и подписываем. */
export function snapshotKindLabel(snapshot: WeatherSnapshot): string {
  const period = snapshot.period === 'hour' ? 'за час' : 'за сутки'
  const kind = snapshot.kind === 'manual' ? 'введено вручную' : snapshot.kind === 'archive' ? 'архив (модельная оценка)' : 'прогноз'
  return `${snapshot.source}, ${kind}, ${period}; получено ${new Date(snapshot.fetchedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
}
