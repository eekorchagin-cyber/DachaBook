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

/** Снежный сезон и другие окна «через Новый год»: окончание раньше начала в календаре. */
export function scheduleCrossesYear(schedule: SeasonSchedule): boolean {
  return schedule.toMonth * 40 + schedule.toDay < schedule.fromMonth * 40 + schedule.fromDay
}

/** Окно сезона, начавшегося в startYear: при переходе через Новый год конец — в следующем году. */
export function seasonWindow(schedule: SeasonSchedule, startYear: number): { start: string; end: string; year: number } {
  const start = calendarDate(startYear, schedule.fromMonth, schedule.fromDay)
  const end = calendarDate(scheduleCrossesYear(schedule) ? startYear + 1 : startYear, schedule.toMonth, schedule.toDay)
  return { start, end, year: startYear }
}

/** Год начала сезона, которому принадлежит день (январь уборки снега — сезон ноября прошлого года). */
export function seasonStartYear(schedule: SeasonSchedule, today: string): number {
  const year = Number(today.slice(0, 4))
  if (!scheduleCrossesYear(schedule)) return year
  const previous = seasonWindow(schedule, year - 1)
  return today >= previous.start && today <= previous.end ? year - 1 : year
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

/** Дни, когда работа по расписанию приходится в сезоне, начавшемся в этом году (окно может зайти в следующий). */
export function seasonOccurrences(schedule: SeasonSchedule, year: number): string[] {
  const { start, end } = seasonWindow(schedule, year)
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

function windowCompletions(work: PlanWork, history: string[], start: string, end: string): string[] {
  return [...new Set([...(work.doneDates ?? []), ...(work.skippedDates ?? []), ...history].filter((date) => date >= start && date <= end))].sort()
}

function slotClosed(occurrence: string, next: string, completions: string[], exact: boolean): boolean {
  return exact ? completions.includes(occurrence) : completions.some((date) => date >= occurrence && date < next)
}

function openOccurrences(occurrences: string[], completions: string[], end: string, exact: boolean): string[] {
  return occurrences.filter((occurrence, index) => !slotClosed(occurrence, occurrences[index + 1] ?? addDays(end, 1), completions, exact))
}

function upcomingStatus(date: string, today: string, suffix: string, prefix: 'с' | 'следующий раз'): WorkStatus {
  const soon = date <= addDays(today, SOON_DAYS)
  return { state: soon ? 'soon' : 'planned', date, message: `${prefix} ${dateText(date)}${suffix}` }
}

/** Состояние работы по расписанию сезона: закрывается один раз, а не весь год. */
function seasonWorkStatus(work: PlanWork, history: string[], context: WorkContext): WorkStatus {
  const { today } = context
  const schedule = work.seasonSchedule
  if (!schedule) return { state: 'check', message: 'Не указано расписание — откройте работу и задайте окно и повтор.' }
  const year = String(seasonStartYear(schedule, today))
  const season = work.seasons[year]
  if (season?.status === 'skipped') return { state: 'skipped' }
  if (season?.status === 'done') return { state: 'done', date: season.date, message: season.date ? `выполнено ${dateText(season.date)}` : undefined }
  if (season?.status === 'postponed' && season.date && today < season.date) {
    return { state: 'postponed', date: season.date, message: `перенесена на ${dateText(season.date)}` }
  }
  const { start, end } = seasonWindow(schedule, Number(year))
  const occurrences = seasonOccurrences(schedule, Number(year))
  const completions = windowCompletions(work, history, start, end)
  const suffix = timeSuffix(schedule)
  const exact = !!schedule.weekdays?.length
  const open = openOccurrences(occurrences, completions, end, exact)
  if (!occurrences.length) return { state: 'check', message: 'В этом окне нет дней по расписанию.' }
  if (today < start) {
    const first = open[0]
    if (!first) return { state: 'done', message: 'в этом сезоне повторы прошли' }
    return upcomingStatus(first, today, suffix, 'с')
  }
  if (today > end) {
    return completions.length
      ? { state: 'done', message: 'сезон этого расписания закончился' }
      : { state: 'overdue', date: end, message: `сезон был до ${dateText(end)}` }
  }
  const due = open.find((date) => date <= today)
  if (due) {
    return due < today
      ? { state: 'overdue', date: due, message: `срок был ${dateText(due)}${suffix}` }
      : { state: 'ready', date: due, message: `сегодня${suffix}` }
  }
  const next = open.find((date) => date > today)
  if (next) return upcomingStatus(next, today, suffix, 'следующий раз')
  return { state: 'done', message: exact ? 'в этом сезоне дни по расписанию прошли' : 'в этом сезоне повторы прошли' }
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
