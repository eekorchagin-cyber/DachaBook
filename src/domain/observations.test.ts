import { describe, expect, it } from 'vitest'
import { isObservationHint, observationDate, OBSERVATION_HINTS } from './observations'

describe('подсказки по наблюдениям', () => {
  it('узнаёт готовые фразы', () => {
    expect(OBSERVATION_HINTS).toContain('Снег сошёл')
    expect(isObservationHint('почва просохла')).toBe(true)
    expect(isObservationHint('Как только просохнет почва после таяния снега')).toBe(false)
  })

  it('находит дату наблюдения этого года по фразе', () => {
    const events = [
      { type: 'observation' as const, date: '2026-04-02', comment: 'Снег сошёл у дома' },
      { type: 'observation' as const, date: '2025-04-10', comment: 'Снег сошёл' },
      { type: 'work' as const, date: '2026-04-03', comment: 'Снег сошёл' },
      { type: 'observation' as const, date: '2026-04-12', comment: 'Почва просохла на грядках' },
    ]
    expect(observationDate(events, 'Снег сошёл', '2026')).toBe('2026-04-02')
    expect(observationDate(events, 'Почва просохла', '2026')).toBe('2026-04-12')
    expect(observationDate(events, 'Снег сошёл', '2025')).toBe('2025-04-10')
  })
})
