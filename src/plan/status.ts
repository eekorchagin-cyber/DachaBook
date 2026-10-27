import { normalizeText } from '../domain/diaryFilter'
import type { DiaryEvent, PlanPeriod, PlanWork, SeasonSchedule } from '../domain/types'
import { addDays, conditionSeason, dateText, evaluateCondition, type DailyMinimums, type FrostStats } from './frost'

export type WorkState = 'ready' | 'overdue' | 'waiting' | 'soon' | 'planned' | 'check' | 'postponed' | 'done' | 'skipped'

export const WORK_STATES: Record<WorkState, string> = {
  ready: 'готова к выполнению',
  overdue: 'срок прошёл',
  waiting: 'ждёт условий',
  soon: 'скоро',
  planned: 'запланирована',
  check: 'требуется проверка',
  postponed: 'перенесена',
  done: 'выполнена',
  skipped: 'пропущена в этом году',
}

export interface WorkStatus {
  state: WorkState
  message?: string
  /** Рекомендуемая дата, крайний срок или начало периода. */
  date?: string
  urgent?: boolean
  /** Однократная работа уже сделана в прошлый год: в этом сезоне среди дел не показывается. */
  closed?: boolean
}

export interface WorkContext {
  today: string
  forecast?: DailyMinimums
  climate?: FrostStats
}

const SOON_DAYS = 14

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Период «месяц / неделя» в датах года: неделя 1 — 1–7 число, 2 — 8–14, 3 — 15–21, 4 и позже — до конца месяца. */
export function periodRange(period: PlanPeriod, year: number): { start: string; end: string } {
  const month = String(period.month).padStart(2, '0')
  const last = lastDayOfMonth(year, period.month)
  if (!period.week) return { start: `${year}-${month}-01`, end: `${year}-${month}-${last}` }
  const first = (period.week - 1) * 7 + 1
  const end = period.week >= 4 ? last : Math.min(period.week * 7, last)
  return { start: `${year}-${month}-${String(Math.min(first, last)).padStart(2, '0')}`, end: `${year}-${month}-${String(end).padStart(2, '0')}` }
}

/** Ближайший к сегодняшнему период работы в этом году: текущий, будущий или (если всё прошло) последний. */
function currentRange(periods: PlanPeriod[], today: string): { start: string; end: string } | undefined {
  const ranges = periods.map((period) => periodRange(period, Number(today.slice(0, 4)))).sort((a, b) => a.start.localeCompare(b.start))
  return ranges.find((range) => range.end >= today) ?? ranges.at(-1)
}

/** Записи дневника об этой работе: отмеченные из плана и найденные по словам (все группы слов должны встретиться). */
export function workHistory(work: PlanWork, events: DiaryEvent[]): string[] {
  const groups = (work.historyWords ?? []).map((group) => group.map((word) => normalizeText(word)))
  return events
    .filter((event) => !event.deletedAt)
    .filter((event) => {
      if (event.planWorkId === work.id) return true
      if (groups.length === 0) return false
      const text = normalizeText(event.comment)
      return groups.every((group) => group.some((word) => text.includes(word)))
    })
    .map((event) => event.date)
    .sort()
    .reverse()
}

function calendarDate(year: number, month: number, day: number): string {
  const last = lastDayOfMonth(year, month)
  const safe = Math.min(Math.max(day, 1), last)
  return `${year}-${String(month).padStart(2, '0')}-${String(safe).padStart(2, '0')}`
}

/** 1 — понедельник … 7 — воскресенье. */
function isoWeekday(date: string): number {
  const js = new Date(`${date}T12:00:00Z`).getUTCDay()
  return js === 0 ? 7 : js
}

function timeSuffix(schedule: SeasonSchedule): string {
  if (schedule.timeFrom && schedule.timeTo) return `, ${schedule.timeFrom}–${schedule.timeTo}`
  if (schedule.timeFrom) return `, ${schedule.timeFrom}`
  return ''
}

/** Дни, когда работа по расписанию приходится в этом году. Окно не переходит через Новый год. */
export function seasonOccurrences(schedule: SeasonSchedule, year: number): string[] {
  const start = calendarDate(year, schedule.fromMonth, schedule.fromDay)
  const end = calendarDate(year, schedule.toMonth, schedule.toDay)
  if (start > end) return []
  const dates: string[] = []
  if (schedule.weekdays?.length) {
    const days = new Set(schedule.weekdays)
    for (let date = start; date <= end; date = addDays(date, 1)) if (days.has(isoWeekday(date))) dates.push(date)
    return dates
  }
  const step = Math.max(1, schedule.everyWeeks ?? 1) * 7
  for (let date = start; date <= end; date = addDays(date, step)) dates.push(date)
  return dates
}

function yearCompletions(work: PlanWork, history: string[], year: string): string[] {
  return [...new Set([...(work.doneDates ?? []), ...history].filter((date) => date.startsWith(year)))].sort()
}

/** Состояние работы по расписанию сезона: закрывается один раз, а не весь год. */
function seasonWorkStatus(work: PlanWork, history: string[], context: WorkContext): WorkStatus {
  const { today } = context
  const year = today.slice(0, 4)
  const season = work.seasons[year]
  if (season?.status === 'skipped') return { state: 'skipped' }
  if (season?.status === 'done') return { state: 'done', date: season.date, message: season.date ? `выполнено ${dateText(season.date)}` : undefined }
  if (season?.status === 'postponed' && season.date && today < season.date) {
    return { state: 'postponed', date: season.date, message: `перенесена на ${dateText(season.date)}` }
  }
  const schedule = work.seasonSchedule
  if (!schedule) return { state: 'check', message: 'Не указано расписание — откройте работу и задайте окно и повтор.' }
  const start = calendarDate(Number(year), schedule.fromMonth, schedule.fromDay)
  const end = calendarDate(Number(year), schedule.toMonth, schedule.toDay)
  if (start > end) return { state: 'check', message: 'Окно расписания переходит через Новый год — укажите даты внутри одного года.' }
  const occurrences = seasonOccurrences(schedule, Number(year))
  const completions = yearCompletions(work, history, year)
  const suffix = timeSuffix(schedule)
  if (!occurrences.length) return { state: 'check', message: 'В этом окне нет дней по расписанию.' }
  if (today < start) {
    const first = occurrences[0]
    return { state: first <= addDays(today, SOON_DAYS) ? 'soon' : 'planned', date: first, message: `с ${dateText(first)}${suffix}` }
  }
  if (today > end) {
    return completions.length
      ? { state: 'done', message: 'сезон этого расписания закончился' }
      : { state: 'overdue', date: end, message: `сезон был до ${dateText(end)}` }
  }
  if (schedule.weekdays?.length) {
    const doneToday = completions.some((date) => date === today)
    if (occurrences.includes(today) && !doneToday) return { state: 'ready', date: today, message: `сегодня${suffix}` }
    const next = occurrences.find((date) => date > today)
    if (next) return { state: next <= addDays(today, SOON_DAYS) ? 'soon' : 'planned', date: next, message: `следующий раз ${dateText(next)}${suffix}` }
    return { state: 'done', message: 'в этом сезоне дни по расписанию прошли' }
  }
  for (let index = 0; index < occurrences.length; index += 1) {
    const occurrence = occurrences[index]
    if (occurrence > today) break
    const next = occurrences[index + 1] ?? addDays(end, 1)
    const done = completions.some((date) => date >= occurrence && date < next)
    if (!done) {
      return occurrence < today
        ? { state: 'overdue', date: occurrence, message: `срок был ${dateText(occurrence)}${suffix}` }
        : { state: 'ready', date: occurrence, message: `сегодня${suffix}` }
    }
  }
  const next = occurrences.find((date) => date > today)
  if (next) return { state: next <= addDays(today, SOON_DAYS) ? 'soon' : 'planned', date: next, message: `следующий раз ${dateText(next)}${suffix}` }
  return { state: 'done', message: 'в этом сезоне повторы прошли' }
}

function onceClosed(work: PlanWork, history: string[], today: string): boolean {
  const year = today.slice(0, 4)
  if (Object.entries(work.seasons).some(([itemYear, season]) => itemYear < year && season.status === 'done')) return true
  return history.some((date) => date.slice(0, 4) < year)
}

/** Состояние работы на сегодня: отметки сезона, записи дневника этого сезона, затем условие или период. */
export function workStatus(work: PlanWork, history: string[], context: WorkContext): WorkStatus {
  const { today } = context
  if (work.recurrence === 'once' && onceClosed(work, history, today)) {
    return { state: 'done', closed: true, message: 'сделано и больше не повторяется' }
  }
  if (work.recurrence === 'season') return seasonWorkStatus(work, history, context)
  const year = Number(today.slice(0, 4))
  const season = work.seasons[String(year)]
  if (season?.status === 'done') return { state: 'done', date: season.date, message: season.date ? `выполнено ${dateText(season.date)}` : undefined }
  if (season?.status === 'skipped') return { state: 'skipped' }

  const window = work.condition ? conditionSeason(work.condition, year) : currentRange(work.periods, today)
  const doneThisSeason = window && history.find((date) => date >= window.start && date <= today)
  if (doneThisSeason) return { state: 'done', date: doneThisSeason, message: `выполнено ${dateText(doneThisSeason)} (по дневнику)` }

  if (season?.status === 'postponed' && season.date) {
    if (today < season.date) return { state: 'postponed', date: season.date, message: `перенесена на ${dateText(season.date)}` }
    return { state: 'ready', date: season.date, message: `перенесена на ${dateText(season.date)}` }
  }

  if (work.condition) {
    const result = evaluateCondition(work.condition, context)
    return { state: result.state, message: result.message, date: result.dueDate, urgent: result.urgent }
  }
  if (!window) return { state: 'check', message: 'Не указан срок — откройте работу и задайте месяц или условие.' }
  if (today < window.start) {
    return { state: window.start <= addDays(today, SOON_DAYS) ? 'soon' : 'planned', date: window.start, message: `с ${dateText(window.start)} по ${dateText(window.end)}` }
  }
  if (today <= window.end) return { state: 'ready', date: window.end, message: `до ${dateText(window.end)}` }
  return { state: 'overdue', date: window.end, message: `срок был до ${dateText(window.end)}` }
}

const ORDER: WorkState[] = ['overdue', 'ready', 'waiting', 'check', 'soon', 'postponed', 'planned', 'done', 'skipped']

export function compareStatus(a: WorkStatus, b: WorkStatus): number {
  return ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || Number(!!b.urgent) - Number(!!a.urgent) || (a.date ?? '9999').localeCompare(b.date ?? '9999')
}

/** Для главного экрана: что делать сейчас и в ближайшие две недели. */
export function isUpcoming(status: WorkStatus): boolean {
  return ['overdue', 'ready', 'waiting', 'check', 'soon'].includes(status.state)
}
