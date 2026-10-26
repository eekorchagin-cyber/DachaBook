import { MONTHS_GENITIVE } from '../domain/dates'
import type { WorkCondition } from '../domain/types'

/** Суточные минимумы температуры воздуха (из архива или прогноза Open-Meteo). */
export interface DailyMinimums {
  time: string[]
  temperature_2m_min: (number | null)[]
}

/** Заморозки одного года: последний весенний (январь — июнь) и первый осенний (июль — декабрь). */
export interface FrostYear {
  year: number
  lastSpring?: string
  firstAutumn?: string
}

/** Многолетняя картина заморозков: даты как «ММ-ДД» — обычная (медиана), самая ранняя и самая поздняя. */
export interface FrostStats {
  years: number
  spring?: { median: string; earliest: string; latest: string }
  autumn?: { median: string; earliest: string; latest: string }
}

export const FROST_THRESHOLD_C = 0
const DAY_MS = 24 * 60 * 60 * 1000

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

export function dateText(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${day} ${MONTHS_GENITIVE[month - 1]}`
}

const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
export const weekdayName = (date: string) => WEEKDAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()]

/** Ближайший день недели (0 — воскресенье, 6 — суббота) не раньше даты. */
export function nextWeekday(date: string, weekday: number): string {
  const current = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addDays(date, (weekday - current + 7) % 7)
}

export function frostYears(daily: DailyMinimums, threshold = FROST_THRESHOLD_C): FrostYear[] {
  const years = new Map<number, FrostYear>()
  daily.time.forEach((date, index) => {
    const min = daily.temperature_2m_min[index]
    if (min === null || min === undefined || min >= threshold) return
    const year = Number(date.slice(0, 4))
    const entry = years.get(year) ?? { year }
    if (Number(date.slice(5, 7)) <= 6) entry.lastSpring = date
    else entry.firstAutumn ??= date
    years.set(year, entry)
  })
  return [...years.values()].sort((a, b) => a.year - b.year)
}

/** «ММ-ДД» → день года по невисокосному году и обратно: медиана дат разных лет. */
const dayOfYear = (monthDay: string) => Math.round((Date.parse(`2001-${monthDay}T00:00:00Z`) - Date.parse('2001-01-01T00:00:00Z')) / DAY_MS)
const monthDayOf = (day: number) => new Date(Date.parse('2001-01-01T00:00:00Z') + day * DAY_MS).toISOString().slice(5, 10)

function summary(dates: string[]): { median: string; earliest: string; latest: string } | undefined {
  if (dates.length === 0) return undefined
  const days = dates.map((date) => dayOfYear(date.slice(5))).sort((a, b) => a - b)
  const middle = days.length / 2
  const median = days.length % 2 ? days[Math.floor(middle)] : Math.round((days[middle - 1] + days[middle]) / 2)
  return { median: monthDayOf(median), earliest: monthDayOf(days[0]), latest: monthDayOf(days.at(-1)!) }
}

export function frostStats(years: FrostYear[]): FrostStats {
  return {
    years: years.length,
    spring: summary(years.flatMap((year) => (year.lastSpring ? [year.lastSpring] : []))),
    autumn: summary(years.flatMap((year) => (year.firstAutumn ? [year.firstAutumn] : []))),
  }
}

/** Первый заморозок в прогнозе с сегодняшнего дня на days дней вперёд. */
export function nextFrost(forecast: DailyMinimums, today: string, days: number, threshold = FROST_THRESHOLD_C): { date: string; min: number } | undefined {
  const last = addDays(today, days)
  for (const [index, date] of forecast.time.entries()) {
    const min = forecast.temperature_2m_min[index]
    if (date >= today && date <= last && min !== null && min !== undefined && min < threshold) return { date, min }
  }
  return undefined
}

/** Последний заморозок за прошедшие days дней (до вчера включительно). */
export function recentFrost(forecast: DailyMinimums, today: string, days: number, threshold = FROST_THRESHOLD_C): { date: string; min: number } | undefined {
  const first = addDays(today, -days)
  let found: { date: string; min: number } | undefined
  for (const [index, date] of forecast.time.entries()) {
    const min = forecast.temperature_2m_min[index]
    if (date >= first && date < today && min !== null && min !== undefined && min < threshold) found = { date, min }
  }
  return found
}

export interface ConditionResult {
  /** ready — можно делать; waiting — ждём условий; planned — время ещё не пришло; check — не хватает данных. */
  state: 'ready' | 'waiting' | 'planned' | 'check'
  message: string
  /** Рекомендуемая дата или крайний срок. */
  dueDate?: string
  urgent?: boolean
}

const minText = (min: number) => `${min > 0 ? '+' : ''}${Math.round(min)} °C`
const inYear = (today: string, monthDay: string) => `${today.slice(0, 4)}-${monthDay}`

/** Сезоны, в которых условие имеет смысл: весенние работы — март — июнь, осенние — август — декабрь. */
export function conditionSeason(condition: WorkCondition, year: number): { start: string; end: string } {
  return condition.type === 'afterSpringFrost' ? { start: `${year}-03-01`, end: `${year}-06-30` } : { start: `${year}-08-01`, end: `${year}-12-31` }
}

/**
 * Готовность работы, привязанной к заморозкам: по прогнозу (неделя назад и вперёд) и многолетним данным архива.
 * Без прогноза и многолетних данных — «требуется проверка», а не «условия выполнены».
 */
export function evaluateCondition(condition: WorkCondition, context: { today: string; forecast?: DailyMinimums; climate?: FrostStats }): ConditionResult {
  const { today, forecast, climate } = context
  const threshold = condition.thresholdC ?? FROST_THRESHOLD_C
  const season = conditionSeason(condition, Number(today.slice(0, 4)))

  if (condition.type === 'afterSpringFrost') {
    const usual = climate?.spring ? ` По многолетним данным последние заморозки обычно около ${dateText(inYear(today, climate.spring.median))} (самые поздние — ${dateText(inYear(today, climate.spring.latest))}).` : ''
    if (today < season.start || today > season.end) return { state: 'planned', message: `Весной, после последних заморозков.${usual}` }
    if (!forecast) return { state: 'check', message: `Нет прогноза погоды — проверьте ночные температуры вручную.${usual}` }
    const calmDays = condition.calmDays ?? 3
    const ahead = nextFrost(forecast, today, 7, threshold)
    const behind = recentFrost(forecast, today, calmDays, threshold)
    if (ahead) return { state: 'waiting', message: `По прогнозу ещё заморозок: ${dateText(ahead.date)}, ${minText(ahead.min)}.${usual}` }
    if (behind) return { state: 'waiting', message: `Заморозок был ${dateText(behind.date)} (${minText(behind.min)}) — ждём ${calmDays} дня без заморозков.${usual}` }
    const day = nextWeekday(today, condition.weekday ?? 6)
    return {
      state: 'ready',
      dueDate: day,
      message: `Ночи без заморозков последние ${calmDays} дня и неделю вперёд по прогнозу. Рекомендуемый день: ${weekdayName(day)}, ${dateText(day)}.`,
    }
  }

  const usual = climate?.autumn ? ` По многолетним данным первые заморозки обычно около ${dateText(inYear(today, climate.autumn.median))} (самые ранние — ${dateText(inYear(today, climate.autumn.earliest))}).` : ''
  if (today < season.start) return { state: 'planned', message: `Осенью, за ${condition.leadDays} дней до первых заморозков.${usual}` }
  const frost = forecast ? nextFrost(forecast, today, condition.leadDays, threshold) : undefined
  if (frost) {
    const deadline = addDays(frost.date, -1) < today ? today : addDays(frost.date, -1)
    return { state: 'ready', urgent: true, dueDate: deadline, message: `Заморозок по прогнозу ${dateText(frost.date)}: ${minText(frost.min)}. Сделайте до ${dateText(deadline)}.` }
  }
  if (climate?.autumn) {
    const usualDate = inYear(today, climate.autumn.median)
    const warnFrom = addDays(usualDate, -condition.leadDays)
    if (today >= warnFrom) {
      return { state: 'ready', dueDate: usualDate < today ? today : addDays(usualDate, -1), message: `Подходит время первых заморозков.${usual}${forecast ? ' В прогнозе на неделю заморозков пока нет.' : ''}` }
    }
    return { state: 'planned', dueDate: warnFrom, message: `Напомню за ${condition.leadDays} дней до обычного срока или раньше, если заморозок появится в прогнозе.${usual}` }
  }
  if (!forecast) return { state: 'check', message: 'Нет прогноза и многолетних данных — следите за ночными температурами.' }
  return { state: 'planned', message: `В прогнозе на ${condition.leadDays} дней заморозков нет — напомню, когда появятся.` }
}
