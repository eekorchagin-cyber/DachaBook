import { repo } from '../app/store'
import type { PlanDraftItem, PlanWork, WorkSeason } from '../domain/types'
import { suggestWorkKind } from '../import/suggest'
import { seasonWindow } from './status'
import { db } from '../storage/db'

/** Позиция черновика (работа) → плановая работа с теми же сроками и объектами; в черновике отмечается перенос. */
export async function transferDraft(item: PlanDraftItem): Promise<PlanWork> {
  if (item.itemType !== 'work') throw new Error('Наблюдения не становятся работами — они остаются ориентиром в черновике')
  if (item.transferred) throw new Error('Эта позиция уже перенесена в план работ')
  const text = item.text.replace(/\s+/g, ' ').trim()
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0]
  const title = text.length <= 100 ? text : firstSentence.length <= 100 ? firstSentence : `${text.slice(0, 97)}…`
  const work = await repo.create('planWorks', {
    title,
    note: title === text ? undefined : text,
    workKind: suggestWorkKind(text),
    objectIds: item.objectIds,
    plantGroupIds: item.plantGroupIds,
    recurrence: 'yearly',
    periods: item.periods,
    sourceDraftId: item.id,
    seasons: {},
    active: true,
  })
  await repo.update('planDrafts', item.id, { transferred: true }, item.revision)
  return work
}

/** Короткая отметка «сделано» на дату: следующий раз по расписанию считается от неё, дневник не создаётся. */
export async function markDone(workId: string, date: string): Promise<void> {
  const work = await db.planWorks.get(workId)
  if (!work || work.doneDates?.includes(date) || work.skippedDates?.includes(date)) return
  await repo.update('planWorks', workId, { doneDates: [...(work.doneDates ?? []), date].sort() }, work.revision)
}

/** Пропуск только этого раза по расписанию: следующий срок остаётся, дневник не создаётся. */
export async function skipOccurrence(workId: string, date: string): Promise<void> {
  const work = await db.planWorks.get(workId)
  if (!work || work.skippedDates?.includes(date) || work.doneDates?.includes(date)) return
  await repo.update('planWorks', workId, { skippedDates: [...(work.skippedDates ?? []), date].sort() }, work.revision)
}

/** Снимает отметку этого года: статус сезона, последний пропуск или последнюю короткую отметку «сделано». Запись дневника не трогает. */
export async function undoMark(workId: string, year: string): Promise<void> {
  const work = await db.planWorks.get(workId)
  if (!work) return
  if (work.seasons[year]) {
    await setSeason(workId, year, null)
    return
  }
  const inWindow = (date: string) => {
    if (work.recurrence === 'season' && work.seasonSchedule) {
      const { start, end } = seasonWindow(work.seasonSchedule, Number(year))
      return date >= start && date <= end
    }
    return date.startsWith(year)
  }
  const latestSkip = (work.skippedDates ?? []).filter(inWindow).sort().at(-1)
  const latestDone = (work.doneDates ?? []).filter(inWindow).sort().at(-1)
  if (latestSkip && (!latestDone || latestSkip >= latestDone)) {
    await repo.update('planWorks', workId, { skippedDates: (work.skippedDates ?? []).filter((date) => date !== latestSkip) }, work.revision)
    return
  }
  if (!latestDone) return
  await repo.update('planWorks', workId, { doneDates: (work.doneDates ?? []).filter((date) => date !== latestDone) }, work.revision)
}

/** Записи дневника, из которых собрано предложение, связываются с новой плановой работой. */
export async function attachPlanWork(eventIds: string[], workId: string): Promise<void> {
  for (const id of eventIds) {
    const event = await db.events.get(id)
    if (!event || event.deletedAt || event.planWorkId) continue
    await repo.update('events', id, { planWorkId: workId }, event.revision)
  }
}

/** Убрать работу из предложений плана. Записи дневника остаются. */
export async function dismissPlanSuggestions(eventIds: string[]): Promise<void> {
  for (const id of eventIds) {
    const event = await db.events.get(id)
    if (!event || event.deletedAt || event.planSuggestionDismissed) continue
    await repo.update('events', id, { planSuggestionDismissed: true }, event.revision)
  }
}

/** Отметка сезона (выполнена, перенесена, пропущена) или её снятие; читает свежую версию работы. */
export async function setSeason(workId: string, year: string, season: WorkSeason | null): Promise<void> {
  const work = await db.planWorks.get(workId)
  if (!work) return
  const seasons = { ...work.seasons }
  if (season) seasons[year] = season
  else delete seasons[year]
  await repo.update('planWorks', workId, { seasons }, work.revision)
}
