import { describe, expect, it } from 'vitest'
import { remainingPhrase, stageHeadline, StageClock, StageEta, withStageTime } from './eta'

describe('оставшееся время этапа', () => {
  it('называет минуты и часы', () => {
    expect(remainingPhrase(30_000)).toBe('До конца этапа осталось меньше минуты.')
    expect(remainingPhrase(60_000)).toBe('До конца этапа осталось около 1 минуты.')
    expect(remainingPhrase(2 * 60_000)).toBe('До конца этапа осталось около 2 минут.')
    expect(remainingPhrase(5 * 60_000)).toBe('До конца этапа осталось около 5 минут.')
    expect(remainingPhrase(11 * 60_000)).toBe('До конца этапа осталось около 11 минут.')
    expect(remainingPhrase(21 * 60_000)).toBe('До конца этапа осталось около 21 минуты.')
    expect(remainingPhrase(60 * 60_000)).toBe('До конца этапа осталось около 1 часа.')
    const evening = new Date(2026, 10, 19, 22, 0)
    expect(remainingPhrase(90 * 60_000, evening)).toBe('Ожидается, что этап завершится в 23:30.')
    expect(remainingPhrase(2 * 60 * 60_000, new Date(2026, 10, 19, 23, 30))).toBe('Ожидается, что этап завершится завтра в 1:30.')
    expect(remainingPhrase(30 * 60 * 60_000, evening)).toBe('Ожидается, что этап завершится 21 ноября в 4:00.')
  })

  it('не дописывает срок этапа второй раз', () => {
    const head = 'Фото и файлы: 1074 из 1467.'
    const now = new Date(2026, 10, 19, 22, 0).getTime()
    const endsAt = now + 4 * 60 * 60_000 + 28 * 60_000
    const line = withStageTime(head, endsAt, now)
    expect(line).toBe('Фото и файлы: 1074 из 1467. Ожидается, что этап завершится завтра в 2:28.')
    expect(withStageTime(stageHeadline(line), endsAt, now)).toBe(line)
    expect(stageHeadline('Фото и файлы: 1 из 2. До конца этапа осталось около 5 минут.')).toBe('Фото и файлы: 1 из 2.')
    expect(stageHeadline('Фото и файлы: 1 из 2. До конца этапа: оцениваю время.')).toBe('Фото и файлы: 1 из 2.')
  })

  it('молчит, пока этап ещё не начался, и считает по средней скорости', () => {
    const eta = new StageEta(10)
    eta.start(0)
    expect(eta.suffix(500)).toBe(' До конца этапа: оцениваю время.')
    eta.finish()
    expect(eta.suffix(500)).toBe(' До конца этапа: оцениваю время.')
    // 10 секунд на 1 элемент, впереди ещё 9: полторы минуты, на экране — около 2 минут.
    expect(eta.suffix(10_000)).toBe(' До конца этапа осталось около 2 минут.')
    eta.finish()
    // 20 секунд на 2 элемента, впереди ещё 8: около минуты.
    expect(eta.suffix(20_000)).toBe(' До конца этапа осталось около 1 минуты.')
  })

  it('до копирования называет срок всего объёма, а не одного файла', () => {
    const clock = new StageClock(1000, 100)
    expect(clock.endsAt(1_000)).toBe(11_000)
    clock.markStart(1_000)
    expect(clock.endsAt(6_000)).toBe(16_000)
    clock.settle(500, 500)
    expect(clock.endsAt(6_000)).toBe(11_000)
  })

  it('без известной скорости ждёт первой передачи и вычитает байты, которые передавать не пришлось', () => {
    const unknown = new StageClock(1000, 0)
    expect(unknown.endsAt(1_000)).toBeNull()
    unknown.markStart(0)
    unknown.settle(250, 250)
    expect(unknown.endsAt(5_000)).toBe(20_000)
    const skipped = new StageClock(1000, 10)
    skipped.settle(400, 0)
    expect(skipped.pending()).toBe(600)
    expect(skipped.endsAt(0)).toBe(60_000)
  })

  it('добирает объём этапа по мере того, как становятся известны порции', () => {
    const eta = new StageEta()
    eta.start(0)
    expect(eta.suffix(5_000)).toBe('')
    eta.addTotal(4)
    eta.finish()
    expect(eta.suffix(4_000)).toBe(' До конца этапа осталось меньше минуты.')
  })
})
