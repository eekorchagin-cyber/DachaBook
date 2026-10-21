import { describe, expect, it } from 'vitest'
import { locationText, parseLocation } from './location'

describe('координаты участка', () => {
  it('понимает разные способы записи и округляет до ~1 км', () => {
    expect(parseLocation('55.751244, 37.618423')).toEqual({ latitude: 55.75, longitude: 37.62 })
    expect(parseLocation('55.751244 37.618423')).toEqual({ latitude: 55.75, longitude: 37.62 })
    expect(parseLocation(' 55,751244 37,618423 ')).toEqual({ latitude: 55.75, longitude: 37.62 })
    expect(parseLocation('55,751244; 37,618423')).toEqual({ latitude: 55.75, longitude: 37.62 })
  })

  it('отклоняет ошибочный ввод', () => {
    expect(parseLocation('')).toBeNull()
    expect(parseLocation('Москва')).toBeNull()
    expect(parseLocation('95.1, 37.6')).toBeNull()
    expect(parseLocation('55.75')).toBeNull()
  })

  it('показывает координаты с двумя знаками', () => {
    expect(locationText({ latitude: 55.7, longitude: 37 })).toBe('55.70, 37.00')
  })
})
