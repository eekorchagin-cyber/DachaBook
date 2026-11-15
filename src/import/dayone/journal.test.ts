import { describe, expect, it } from 'vitest'
import { dayOneComment, dayOneDraft, dayOneFingerprint, zonedDateTime } from './journal'

describe('текст и дата Day One', () => {
  it('переводит момент в часовой пояс записи', () => {
    // В 2011–2014 Красноярск был на UTC+8, с октября 2014 снова UTC+7.
    expect(zonedDateTime('2012-12-26T10:48:56Z', 'Asia/Krasnoyarsk')).toEqual({ date: '2012-12-26', time: '18:48' })
    expect(zonedDateTime('2012-12-26T20:00:00Z', 'Asia/Krasnoyarsk')).toEqual({ date: '2012-12-27', time: '04:00' })
  })

  it('берёт текст из rich text и снимает экранирование Markdown', () => {
    const rich = JSON.stringify({
      contents: [{ embeddedObjects: [{ type: 'photo' }] }, { text: '  Заголовок  ' }, { text: 'Вторая строка' }],
    })
    expect(dayOneComment({ richText: rich, text: 'не этот' })).toBe('Заголовок\nВторая строка')
    expect(dayOneComment({ text: '\n# Заголовок\\.\n\n\nТекст\\-строка\n' })).toBe('Заголовок.\n\nТекст-строка')
  })

  it('собирает наблюдение с погодой и без пустого дня', () => {
    const draft = dayOneDraft(
      {
        uuid: 'ABC',
        creationDate: '2016-07-23T15:00:00Z',
        timeZone: 'Asia/Krasnoyarsk',
        text: 'Полил грядки\\.',
        weather: { weatherCode: 'snow-showers', weatherServiceName: 'Forecast.io', temperatureCelsius: -2.24, relativeHumidity: 0, windSpeedKPH: 36 },
        location: { latitude: 56.04, longitude: 92.54 },
        photos: [{ md5: 'AABB', type: 'jpeg', filename: 'IMG.JPG', orderInEntry: 2 }, { md5: 'CCDD', type: 'png', orderInEntry: 1 }],
        videos: [{ md5: 'EEFF', type: 'mov', orderInEntry: 0 }],
      },
      { photos: true, videos: false },
    )
    expect(draft?.date).toBe('2016-07-23')
    expect(draft?.time).toBe('22:00')
    expect(draft?.comment).toBe('Полил грядки.')
    expect(draft?.weather).toMatchObject({ condition: 'snow', airTemperature: -2.2, windMs: 10, source: 'Forecast.io', kind: 'manual' })
    expect(draft?.weather?.humidityPercent).toBeUndefined()
    expect(draft?.media.map((item) => item.md5)).toEqual(['ccdd', 'aabb'])
    expect(dayOneDraft({ uuid: 'EMPTY', creationDate: '2016-07-23T15:00:00Z', text: '  ' }, { photos: true, videos: false })).toBeUndefined()
    expect(dayOneFingerprint('ABC')).toBe('dayone:ABC')
  })
})
