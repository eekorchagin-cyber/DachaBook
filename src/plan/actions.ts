import { repo } from '../app/store'
import type { PlanDraftItem, PlanWork, WorkSeason } from '../domain/types'
import { suggestWorkKind } from '../import/suggest'
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

/** Отметка сезона (выполнена, перенесена, пропущена) или её снятие; читает свежую версию работы. */
export async function setSeason(workId: string, year: string, season: WorkSeason | null): Promise<void> {
  const work = await db.planWorks.get(workId)
  if (!work) return
  const seasons = { ...work.seasons }
  if (season) seasons[year] = season
  else delete seasons[year]
  await repo.update('planWorks', workId, { seasons }, work.revision)
}
