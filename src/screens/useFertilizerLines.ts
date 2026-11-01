import { useLiveQuery } from 'dexie-react-hooks'
import { fertilizerLines, type FertilizerLine } from '../domain/careLinks'
import { todayAtSite } from '../domain/dates'
import type { Consumable } from '../domain/types'
import { db } from '../storage/db'

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

/** Строки расчёта удобрения по связкам. Черновики площади и нормы учитываются до сохранения карточки. */
export function useFertilizerLines(options?: {
  plantGroupId?: string
  workKind?: string
  consumableId?: string
  draftArea?: string
  draftConsumable?: Partial<Pick<Consumable, 'unit' | 'ratePerM2' | 'rateUnit' | 'packQuantity' | 'packUnit'>>
}): FertilizerLine[] | undefined {
  const consumables = useLiveQuery(() => db.consumables.toArray(), [])
  const groups = useLiveQuery(() => db.plantGroups.toArray(), [])
  const works = useLiveQuery(() => db.planWorks.toArray(), [])
  if (!consumables || !groups || !works) return undefined
  const draftConsumable = options?.draftConsumable
  const consumableId = options?.consumableId
  const nextConsumables =
    consumableId && draftConsumable ? consumables.map((item) => (item.id === consumableId ? { ...item, ...draftConsumable } : item)) : consumables
  const draftArea = options?.draftArea
  const plantGroupId = options?.plantGroupId
  const nextGroups =
    plantGroupId && draftArea !== undefined
      ? groups.map((group) => (group.id === plantGroupId ? { ...group, areaM2: numberOrUndefined(draftArea) } : group))
      : groups
  return fertilizerLines({
    consumables: nextConsumables,
    groups: nextGroups,
    works,
    today: todayAtSite().date,
    plantGroupId: options?.plantGroupId,
    workKind: options?.workKind,
    consumableId: options?.consumableId,
  })
}
