import type { DiaryEvent, EventType, ObjectType, PlanPeriod, SeasonSchedule, WeatherCondition } from './types'

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

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** Подпись расписания внутри сезона: шаг или дни недели, время и окно дат. */
export function scheduleText(schedule: SeasonSchedule): string {
  const span = `с ${schedule.fromDay} ${MONTHS_SHORT[schedule.fromMonth - 1]} по ${schedule.toDay} ${MONTHS_SHORT[schedule.toMonth - 1]}`
  const rhythm = schedule.weekdays?.length
    ? `по ${[...schedule.weekdays].sort((a, b) => a - b).map((day) => WEEKDAYS_SHORT[day - 1]).join(', ')}`
    : schedule.everyWeeks === 1
      ? 'каждую неделю'
      : `каждые ${schedule.everyWeeks ?? 1} нед.`
  const time = schedule.timeFrom && schedule.timeTo ? `, ${schedule.timeFrom}–${schedule.timeTo}` : schedule.timeFrom ? `, ${schedule.timeFrom}` : ''
  return `${rhythm}${time}, ${span}`
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
