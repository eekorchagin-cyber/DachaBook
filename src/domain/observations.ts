import { normalizeText } from './diaryFilter'
import type { DiaryEvent } from './types'

/** Готовые наблюдения, по которым работа сама становится готовой. */
export const OBSERVATION_HINTS = ['Снег сошёл', 'Почва просохла'] as const

/** Это условие из списка подсказок, а не просто подпись. */
export function isObservationHint(text: string): boolean {
  const key = normalizeText(text)
  return OBSERVATION_HINTS.some((hint) => normalizeText(hint) === key)
}

/** Дата наблюдения этого года, в котором встречается фраза. */
export function observationDate(
  events: Pick<DiaryEvent, 'type' | 'date' | 'comment' | 'deletedAt'>[],
  text: string,
  year: string,
): string | undefined {
  const needle = normalizeText(text)
  if (!needle) return undefined
  return events
    .filter((event) => !event.deletedAt && event.type === 'observation' && event.date.startsWith(year) && normalizeText(event.comment).includes(needle))
    .map((event) => event.date)
    .sort()
    .at(-1)
}
