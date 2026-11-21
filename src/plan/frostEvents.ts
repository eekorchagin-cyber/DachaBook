import type { DiaryEvent, DocInput } from '../domain/types'
import { stableId } from '../lib/hash'
import { Repository } from '../storage/repository'
import type { DiaryDatabase } from '../storage/db'
import { frostYears, type DailyMinimums, type FrostYear } from './frost'

const springComment = (date: string) => `Последние весенние заморозки на участке (${date.slice(8, 10)}.${date.slice(5, 7)}).`
const autumnComment = (date: string) => `Первые осенние заморозки на участке (${date.slice(8, 10)}.${date.slice(5, 7)}).`

/** Уже есть такая автозапись заморозков (по стабильному id или тексту). */
function alreadyHas(events: DiaryEvent[], id: string, date: string, kind: 'spring' | 'autumn'): boolean {
  const marker = kind === 'spring' ? 'Последние весенние заморозки' : 'Первые осенние заморозки'
  return events.some((event) => !event.deletedAt && (event.id === id || (event.date === date && event.type === 'observation' && event.comment.includes(marker))))
}

async function plotObjectId(database: DiaryDatabase): Promise<string[]> {
  const objects = await database.objects.toArray()
  const whole = objects.find((item) => !item.deletedAt && item.name === 'Участок целиком')
  return whole ? [whole.id] : objects.filter((item) => !item.deletedAt && item.active).slice(0, 1).map((item) => item.id)
}

async function putFrost(
  seeder: Repository,
  database: DiaryDatabase,
  events: DiaryEvent[],
  date: string,
  kind: 'spring' | 'autumn',
  objectIds: string[],
): Promise<boolean> {
  const year = date.slice(0, 4)
  const id = await stableId(`frost-observation:${year}:${kind}`)
  if (alreadyHas(events, id, date, kind)) return false
  if (await database.events.get(id)) return false
  const input: DocInput<DiaryEvent> = {
    id,
    type: 'observation',
    date,
    objectIds,
    plantGroupIds: [],
    comment: kind === 'spring' ? springComment(date) : autumnComment(date),
    photoIds: [],
    attachmentIds: [],
  }
  const saved = await seeder.create('events', input)
  events.push(saved)
  return true
}

/** Годы заморозков: архив плюс то, что уже видно в текущем прогнозе. */
export function frostYearsToRecord(climateYears: FrostYear[], forecast: DailyMinimums | undefined, today: string): FrostYear[] {
  const byYear = new Map<number, FrostYear>()
  for (const year of climateYears) byYear.set(year.year, { ...year })
  if (forecast) {
    for (const year of frostYears(forecast)) {
      if (year.year > Number(today.slice(0, 4))) continue
      const current = byYear.get(year.year) ?? { year: year.year }
      if (year.lastSpring && (!current.lastSpring || year.lastSpring > current.lastSpring)) current.lastSpring = year.lastSpring
      if (year.firstAutumn && (!current.firstAutumn || year.firstAutumn < current.firstAutumn)) current.firstAutumn = year.firstAutumn
      byYear.set(year.year, current)
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/**
 * Наблюдения о заморозках в дневник: по одному на последнюю весну и первую осень каждого известного года.
 * Стабильные id — на телефонах и компьютерах не появляются копии.
 */
export async function ensureFrostObservations(
  database: DiaryDatabase,
  climateYears: FrostYear[],
  forecast: DailyMinimums | undefined,
  today: string,
  author = 'DachaBook',
): Promise<number> {
  const years = frostYearsToRecord(climateYears, forecast, today)
  if (years.length === 0) return 0
  const events = await database.events.toArray()
  const objectIds = await plotObjectId(database)
  if (objectIds.length === 0) return 0
  const seeder = new Repository(database, () => author)
  let added = 0
  for (const year of years) {
    if (year.lastSpring && (await putFrost(seeder, database, events, year.lastSpring, 'spring', objectIds))) added++
    if (year.firstAutumn && (await putFrost(seeder, database, events, year.firstAutumn, 'autumn', objectIds))) added++
  }
  return added
}
