import { seasonOccurrences, seasonStartYear } from '../plan/status'
import type { PlanWork } from './types'

/**
 * Сколько раз эта работа приходится за сезон.
 * Берётся только её расписание: окно и повтор, сроки ежегодной работы или один раз.
 * Дневник и другие работы плана не участвуют.
 */
export function workTimes(work: Pick<PlanWork, 'recurrence' | 'periods' | 'seasonSchedule'>, today: string): number {
  if (work.recurrence === 'season' && work.seasonSchedule) {
    return seasonOccurrences(work.seasonSchedule, seasonStartYear(work.seasonSchedule, today)).length
  }
  if (work.recurrence === 'once') return 1
  return Math.max(work.periods.length, 1)
}
