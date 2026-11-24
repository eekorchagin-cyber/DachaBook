import type { CareObject, DiaryEvent, PlantGroup, PlanWork, WateringZone } from './types'

/** Почему объект нельзя удалить навсегда: есть история или привязки. */
export function objectDeleteBlockers(input: {
  objectId: string
  events: Pick<DiaryEvent, 'objectIds' | 'deletedAt'>[]
  works: Pick<PlanWork, 'objectIds' | 'deletedAt'>[]
  zones: Pick<WateringZone, 'objectIds' | 'deletedAt'>[]
  groups: Pick<PlantGroup, 'objectIds' | 'deletedAt'>[]
  object: Pick<CareObject, 'photoIds'>
}): string[] {
  const { objectId } = input
  const reasons: string[] = []
  if (input.events.some((event) => !event.deletedAt && event.objectIds.includes(objectId))) reasons.push('есть записи дневника')
  if (input.works.some((work) => !work.deletedAt && work.objectIds.includes(objectId))) reasons.push('есть плановые работы')
  if (input.zones.some((zone) => !zone.deletedAt && zone.objectIds.includes(objectId))) reasons.push('есть зоны полива')
  if (input.groups.some((group) => !group.deletedAt && group.objectIds.includes(objectId))) reasons.push('есть группы растений')
  if ((input.object.photoIds?.length ?? 0) > 0) reasons.push('есть фотографии')
  return reasons
}
