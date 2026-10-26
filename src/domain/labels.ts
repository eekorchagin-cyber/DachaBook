import type { DiaryEvent, EventType, ObjectType, PlanPeriod, WeatherCondition } from './types'

export const OBJECT_TYPES: Record<ObjectType, string> = {
  lawn: 'Газон',
  garden: 'Сад',
  beds: 'Грядки',
  plants: 'Группа посадок',
  place: 'Место',
}

export const EVENT_TYPES: Record<EventType, { label: string; icon: string }> = {
  work: { label: 'Работа', icon: '⚒' },
  observation: { label: 'Наблюдение', icon: '👁' },
  measurement: { label: 'Измерение', icon: '🌡' },
}

export function weatherText(event: DiaryEvent): string | null {
  const weather = event.weather
  if (!weather) return null
  const parts: string[] = []
  const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  if (weather.airTemperature !== undefined) parts.push(`воздух ${temperatureText(weather.airTemperature)}`)
  else if (weather.airTemperatureMin !== undefined && weather.airTemperatureMax !== undefined) {
    parts.push(`воздух от ${temperatureText(weather.airTemperatureMin)} до ${temperatureText(weather.airTemperatureMax)}`)
  }
  if (weather.precipitationMm !== undefined) parts.push(weather.precipitationMm > 0 ? `осадки ${number(weather.precipitationMm)} мм` : 'без осадков')
  if (weather.humidityPercent !== undefined) parts.push(`влажность ${Math.round(weather.humidityPercent)}%`)
  if (weather.windMs !== undefined) parts.push(`ветер ${number(weather.windMs)} м/с`)
  return parts.join(', ')
}

export function measurementText(event: DiaryEvent): string {
  const parts: string[] = []
  if (event.measurement?.temperature) parts.push(`почва ${event.measurement.temperature.value} °C`)
  if (event.measurement?.moisture) parts.push(`влажность ${event.measurement.moisture.value} (${event.measurement.moisture.scale})`)
  return parts.join(', ')
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function periodText(periods: PlanPeriod[]): string {
  return periods.map((period) => `${MONTHS_SHORT[period.month - 1]}${period.week ? `, нед. ${period.week}` : ''}`).join('; ')
}

export const WEATHER_CONDITIONS: Record<WeatherCondition, { icon: string; label: string }> = {
  clear: { icon: '☀️', label: 'солнце' },
  cloudy: { icon: '☁️', label: 'облачно' },
  rain: { icon: '🌧️', label: 'дождь' },
  snow: { icon: '❄️', label: 'снег' },
  thunderstorm: { icon: '⛈️', label: 'гроза' },
}

export function temperatureText(value: number | undefined): string {
  if (value === undefined) return '—°C'
  return `${value > 0 ? '+' : ''}${Math.round(value)}°C`
}
