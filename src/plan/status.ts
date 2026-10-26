import { normalizeText } from '../domain/diaryFilter'
import type { DiaryEvent, PlanPeriod, PlanWork } from '../domain/types'
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

/** Состояние работы на сегодня: отметки сезона, записи дневника этого сезона, затем условие или период. */
export function workStatus(work: PlanWork, history: string[], context: WorkContext): WorkStatus {
  const { today } = context
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
