import { describe, expect, it } from 'vitest'
import { remainingPhrase, StageEta } from './eta'

describe('оставшееся время этапа', () => {
  it('называет минуты и часы', () => {
    expect(remainingPhrase(30_000)).toBe('Осталось меньше минуты.')
    expect(remainingPhrase(60_000)).toBe('Осталось около 1 минуты.')
    expect(remainingPhrase(2 * 60_000)).toBe('Осталось около 2 минут.')
    expect(remainingPhrase(5 * 60_000)).toBe('Осталось около 5 минут.')
    expect(remainingPhrase(11 * 60_000)).toBe('Осталось около 11 минут.')
    expect(remainingPhrase(21 * 60_000)).toBe('Осталось около 21 минуты.')
    expect(remainingPhrase(60 * 60_000)).toBe('Осталось около 1 часа.')
    expect(remainingPhrase(2 * 60 * 60_000)).toBe('Осталось около 2 часов.')
    expect(remainingPhrase(5 * 60 * 60_000)).toBe('Осталось около 5 часов.')
    expect(remainingPhrase(90 * 60_000)).toBe('Осталось около 1 часа 30 минут.')
  })

  it('молчит, пока этап ещё не начался, и считает по средней скорости', () => {
    const eta = new StageEta(10)
    eta.start(0)
    expect(eta.suffix(500)).toBe(' Оцениваю время.')
    eta.finish()
    expect(eta.suffix(500)).toBe(' Оцениваю время.')
    // 10 секунд на 1 элемент, впереди ещё 9: полторы минуты, на экране — около 2 минут.
    expect(eta.suffix(10_000)).toBe(' Осталось около 2 минут.')
    eta.finish()
    // 20 секунд на 2 элемента, впереди ещё 8: около минуты.
    expect(eta.suffix(20_000)).toBe(' Осталось около 1 минуты.')
  })

  it('добирает объём этапа по мере того, как становятся известны порции', () => {
    const eta = new StageEta()
    eta.start(0)
    expect(eta.suffix(5_000)).toBe('')
    eta.addTotal(4)
    eta.finish()
    expect(eta.suffix(4_000)).toBe(' Осталось меньше минуты.')
  })
})
