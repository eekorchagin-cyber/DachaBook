/** Фаза луны по дате (средний синодический месяц), без обращения к сети; точность — около суток. */

const SYNODIC_MONTH = 29.530588853
/** Новолуние 6 января 2000 г., 18:14 UTC — точка отсчёта. */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

export interface MoonPhase {
  /** Доля лунного месяца от новолуния: 0 — новолуние, 0,5 — полнолуние. */
  age: number
  icon: string
  name: string
}

const PHASES: { icon: string; name: string }[] = [
  { icon: '🌑', name: 'новолуние' },
  { icon: '🌒', name: 'растущий серп' },
  { icon: '🌓', name: 'первая четверть' },
  { icon: '🌔', name: 'растущая луна' },
  { icon: '🌕', name: 'полнолуние' },
  { icon: '🌖', name: 'убывающая луна' },
  { icon: '🌗', name: 'последняя четверть' },
  { icon: '🌘', name: 'убывающий серп' },
]

/** Фаза на полдень даты ГГГГ-ММ-ДД по времени участка (UTC+7). */
export function moonPhase(date: string): MoonPhase {
  const [year, month, day] = date.split('-').map(Number)
  const noonAtSite = Date.UTC(year, month - 1, day, 12 - 7)
  const days = (noonAtSite - KNOWN_NEW_MOON) / 86_400_000
  const age = (((days / SYNODIC_MONTH) % 1) + 1) % 1
  return { age, ...PHASES[Math.round(age * 8) % 8] }
}
