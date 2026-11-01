import { repo } from '../app/store'
import { db } from '../storage/db'

/** Пропуск только сегодня: следующий день по расписанию остаётся. */
export async function skipWateringToday(zoneId: string, today: string): Promise<void> {
  const zone = await db.wateringZones.get(zoneId)
  if (!zone || zone.skippedDates?.includes(today)) return
  await repo.update('wateringZones', zoneId, { skippedDates: [...(zone.skippedDates ?? []), today].sort() }, zone.revision)
}

export async function undoWateringSkip(zoneId: string, today: string): Promise<void> {
  const zone = await db.wateringZones.get(zoneId)
  if (!zone?.skippedDates?.includes(today)) return
  await repo.update('wateringZones', zoneId, { skippedDates: zone.skippedDates.filter((date) => date !== today) }, zone.revision)
}
