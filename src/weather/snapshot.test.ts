import { describe, expect, it } from 'vitest'
import { conditionFromCode, type WeatherSeries } from './openMeteo'
import { needsWeather, snapshotFromSeries, weatherSourceFor } from './snapshot'

const location = { latitude: 55.75, longitude: 37.62 }
const series: WeatherSeries = {
  hourly: {
    time: ['2026-05-18T09:00', '2026-05-18T10:00'],
    temperature_2m: [12.34, 14.06],
    relative_humidity_2m: [70, 65],
    precipitation: [0, 0.4],
    weather_code: [2, 61],
    wind_speed_10m: [3.21, 4.5],
  },
  daily: {
    time: ['2026-05-18', '2026-05-19'],
    weather_code: [61, null],
    temperature_2m_max: [18.5, null],
    temperature_2m_min: [6.9, null],
    precipitation_sum: [2.3, null],
    wind_speed_10m_max: [6.1, null],
    relative_humidity_2m_mean: [62, null],
  },
}

describe('погода для записи', () => {
  it('с указанным временем — данные за этот час', () => {
    expect(snapshotFromSeries(series, location, { date: '2026-05-18', time: '10:45' }, 'archive', 'T')).toMatchObject({
      source: 'Open-Meteo',
      kind: 'archive',
      period: 'hour',
      condition: 'rain',
      airTemperature: 14.1,
      precipitationMm: 0.4,
      humidityPercent: 65,
      windMs: 4.5,
      forDate: '2026-05-18',
      forTime: '10:45',
    })
  })

  it('без времени — суточная сводка; нет данных на дату — ничего, а не чужая погода', () => {
    expect(snapshotFromSeries(series, location, { date: '2026-05-18' }, 'forecast', 'T')).toMatchObject({
      period: 'day',
      condition: 'rain',
      airTemperatureMin: 6.9,
      airTemperatureMax: 18.5,
      precipitationMm: 2.3,
    })
    expect(snapshotFromSeries(series, location, { date: '2026-05-19' }, 'forecast', 'T')).toBeNull()
    expect(snapshotFromSeries(series, location, { date: '2026-06-01' }, 'forecast', 'T')).toBeNull()
  })

  it('прогноз на неделю назад и вперёд, раньше — архив, позже — нет данных', () => {
    expect(weatherSourceFor('2026-10-26', '2026-10-26')).toBe('forecast')
    expect(weatherSourceFor('2026-10-20', '2026-10-26')).toBe('forecast')
    expect(weatherSourceFor('2026-10-19', '2026-10-26')).toBe('archive')
    expect(weatherSourceFor('2021-05-01', '2026-10-26')).toBe('archive')
    expect(weatherSourceFor('2026-11-01', '2026-10-26')).toBe('forecast')
    expect(weatherSourceFor('2026-11-02', '2026-10-26')).toBeNull()
  })

  it('погоду запрашивают заново только при смене даты или времени записи', () => {
    const weather = { source: 'Open-Meteo', kind: 'archive' as const, latitude: 1, longitude: 1, fetchedAt: 'T', period: 'day' as const, forDate: '2026-05-18' }
    expect(needsWeather({ date: '2026-05-18' })).toBe(true)
    expect(needsWeather({ date: '2026-05-18', weather })).toBe(false)
    expect(needsWeather({ date: '2026-05-19', weather })).toBe(true)
    expect(needsWeather({ date: '2026-05-18', time: '09:00', weather })).toBe(true)
  })

  it('коды погоды ВМО превращаются в значки', () => {
    expect([0, 2, 45, 61, 73, 81, 95].map(conditionFromCode)).toEqual(['clear', 'cloudy', 'cloudy', 'rain', 'snow', 'rain', 'thunderstorm'])
  })
})
