import { useEffect, useState } from 'react'
import { todayAtSite } from '../domain/dates'
import { temperatureText, WEATHER_CONDITIONS } from '../domain/labels'
import { conditionFromCode } from '../weather/openMeteo'
import { useForecast } from '../weather/service'

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const DAYS_SHOWN = 5

function age(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 2) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/** Погода на участке сейчас и на ближайшие дни (Open-Meteo, модельный прогноз, а не измерение на участке). */
export function WeatherCard() {
  const { forecast, location, error, loading, refresh } = useForecast()
  // «Обновлён N мин назад» пересчитывается раз в минуту.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (location === null) {
    return (
      <section className="card">
        <h2>Погода на участке</h2>
        <p className="hint">
          Чтобы видеть погоду и прогноз, укажите координаты участка: <a href="#/settings">«Ещё → Настройки → Участок»</a>.
        </p>
      </section>
    )
  }

  const today = todayAtSite().date
  const current = forecast?.current
  const condition = current ? conditionFromCode(current.weather_code) : undefined
  const daily = forecast?.daily
  const start = daily ? Math.max(0, daily.time.indexOf(today)) : 0
  const days = daily ? daily.time.slice(start, start + DAYS_SHOWN).map((date, offset) => ({ date, index: start + offset })) : []
  const stale = forecast && now - Date.parse(forecast.fetchedAt) > 3 * 60 * 60 * 1000

  return (
    <section className="card weather-card">
      <div className="card-header">
        <h2>Погода на участке</h2>
        <button type="button" className="button secondary small" disabled={loading} onClick={() => refresh()}>
          {loading ? 'Обновляю…' : 'Обновить'}
        </button>
      </div>
      {current && (
        <div className="weather-now">
          <span className="weather-now-icon">{condition ? WEATHER_CONDITIONS[condition].icon : '☁︎'}</span>
          <span className="weather-now-temp">{temperatureText(current.temperature_2m)}</span>
          <span className="muted">
            {condition ? WEATHER_CONDITIONS[condition].label : ''}
            {`, влажность ${Math.round(current.relative_humidity_2m)}%, ветер ${Math.round(current.wind_speed_10m)} м/с`}
            {current.precipitation > 0 && `, осадки ${current.precipitation} мм`}
          </span>
        </div>
      )}
      {days.length > 0 && daily && (
        <ul className="weather-days">
          {days.map(({ date, index }) => {
            const dayCondition = conditionFromCode(daily.weather_code[index])
            const precipitation = daily.precipitation_sum[index] ?? 0
            return (
              <li key={date}>
                <span className="weather-day-name">{date === today ? 'сегодня' : `${WEEKDAYS[new Date(`${date}T12:00:00`).getDay()]} ${Number(date.slice(8))}`}</span>
                <span>{dayCondition ? WEATHER_CONDITIONS[dayCondition].icon : '☁︎'}</span>
                <span>
                  {temperatureText(daily.temperature_2m_max[index] ?? undefined)} / {temperatureText(daily.temperature_2m_min[index] ?? undefined)}
                </span>
                <span className="muted small">{precipitation > 0 ? `${Math.round(precipitation * 10) / 10} мм` : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
      {!forecast && !error && <p className="hint">Загружаю прогноз…</p>}
      {error && <p className={forecast ? 'small muted' : 'error'}>{forecast ? `Нет связи с сервисом погоды — показан прогноз, полученный ${age(forecast.fetchedAt, now)}.` : error}</p>}
      {forecast && !error && (
        <p className="small muted">
          Прогноз Open-Meteo для координат участка, обновлён {age(forecast.fetchedAt, now)}
          {stale ? ' — откройте приложение с интернетом, чтобы обновить' : ''}. Это модельная оценка, а не измерение на участке.
        </p>
      )}
    </section>
  )
}
