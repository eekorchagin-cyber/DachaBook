import { temperatureText, WEATHER_CONDITIONS } from '../domain/labels'
import { moonPhase } from '../domain/moon'
import type { DiaryEvent } from '../domain/types'

/** Погода (Open-Meteo, подставляется при сохранении записи) и фаза луны в правом верхнем углу записи. */
export function WeatherBadge({ event }: { event: Pick<DiaryEvent, 'date' | 'weather'> }) {
  const moon = moonPhase(event.date)
  const condition = event.weather?.condition ? WEATHER_CONDITIONS[event.weather.condition] : undefined
  const temperature = event.weather?.airTemperature ?? event.weather?.airTemperatureMax
  const title = [
    condition ? condition.label : 'погоды нет: не заданы координаты участка или не было связи',
    `воздух ${temperatureText(temperature)}`,
    `луна: ${moon.name}`,
  ].join(', ')
  return (
    <span className="weather-badge" title={title} aria-label={title}>
      <span className={condition ? '' : 'placeholder'}>{condition?.icon ?? '☁︎'}</span>
      <span className={temperature === undefined ? 'placeholder' : ''}>{temperatureText(temperature)}</span>
      <span>{moon.icon}</span>
    </span>
  )
}
