import { seasonOccurrences, seasonStartYear } from '../plan/status'
import type { PlanWork } from './types'

const APPLICATION = /подкорм|удобр|обработ|опрыск|посев|посад|внес|мульч/i

export interface PlannedUse {
  id: string
  title: string
  times: number
}

type PlannedWork = Pick<PlanWork, 'id' | 'title' | 'workKind' | 'note' | 'objectIds' | 'active' | 'deletedAt' | 'recurrence' | 'periods' | 'seasonSchedule'>

function isApplication(work: Pick<PlanWork, 'title' | 'workKind' | 'note'>): boolean {
  return APPLICATION.test(`${work.workKind ?? ''} ${work.title} ${work.note ?? ''}`)
}

function sharesObject(workObjectIds: string[], objectIds: string[]): boolean {
  if (!workObjectIds.length || !objectIds.length) return false
  return workObjectIds.some((id) => objectIds.includes(id))
}

function timesOf(work: Pick<PlanWork, 'recurrence' | 'periods' | 'seasonSchedule'>, today: string): number {
  if (work.recurrence === 'season' && work.seasonSchedule) {
    return seasonOccurrences(work.seasonSchedule, seasonStartYear(work.seasonSchedule, today)).length
  }
  if (work.recurrence === 'once') return 1
  return Math.max(work.periods.length, 1)
}

/**
 * Сколько раз за сезон вносится материал: сумма повторов плановых работ
 * (подкормка, обработка, посев) по тем же объектам.
 */
export function applicationWorks(works: PlannedWork[], objectIds: string[], today: string): PlannedUse[] {
  return works
    .filter((work) => !work.deletedAt && work.active && sharesObject(work.objectIds, objectIds) && isApplication(work))
    .map((work) => ({ id: work.id, title: work.title, times: timesOf(work, today) }))
    .filter((work) => work.times > 0)
}

export function plannedTimes(works: PlannedUse[]): number {
  return works.reduce((sum, work) => sum + work.times, 0)
}

/** Подпись «из плана работ» со списком работ и числом повторов. */
export function applicationHint(works: PlannedUse[]): string {
  if (!works.length) return 'В плане работ нет подкормок и обработок по выбранным объектам.'
  const list = works.map((work) => `${work.title} — ${work.times}`).join('; ')
  return `Из плана работ: ${list}.`
}
