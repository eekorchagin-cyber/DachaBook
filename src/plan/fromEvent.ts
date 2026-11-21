import { normalizeText } from '../domain/diaryFilter'
import type { DiaryEvent, DocInput, PlanWork } from '../domain/types'

/** Первое предложение записи — название работы в плане. */
export function workTitle(comment: string): string {
  const sentence = comment.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] ?? ''
  if (!sentence) return ''
  return sentence.length <= 100 ? sentence : `${sentence.slice(0, 97)}…`
}

/** Неделя месяца, как в плане: 1–7, 8–14, 15–21, дальше — до конца месяца. */
export function weekOfMonth(date: string): number {
  return Math.min(4, Math.ceil(Number(date.slice(8, 10)) / 7))
}

/** Карточка ежегодной работы из только что сохранённой записи. Условие пользователь задаёт уже в карточке. */
export function planInputFromEvent(event: Pick<DiaryEvent, 'id' | 'date' | 'comment' | 'workKind' | 'objectIds' | 'plantGroupIds' | 'consumables'>): DocInput<PlanWork> | undefined {
  const title = workTitle(event.comment)
  const month = Number(event.date.slice(5, 7))
  if (!title || month < 1 || month > 12) return undefined
  const consumableIds = [...new Set((event.consumables ?? []).map((item) => item.consumableId))]
  return {
    title,
    workKind: event.workKind,
    objectIds: event.objectIds,
    plantGroupIds: event.plantGroupIds,
    recurrence: 'yearly',
    periods: [{ month, week: weekOfMonth(event.date) }],
    consumableIds: consumableIds.length ? consumableIds : undefined,
    seasons: { [event.date.slice(0, 4)]: { status: 'done', date: event.date, eventId: event.id } },
    active: true,
  }
}

const titleKey = (title: string) => normalizeText(title).replace(/\s+/g, ' ').trim()

/** Такая работа уже есть среди действующих в плане — предлагать её снова не нужно. */
export function planAlreadyHas(works: Pick<PlanWork, 'title' | 'active' | 'deletedAt'>[], title: string): boolean {
  const key = titleKey(title)
  if (!key) return false
  return works.some((work) => !work.deletedAt && work.active && titleKey(work.title) === key)
}
