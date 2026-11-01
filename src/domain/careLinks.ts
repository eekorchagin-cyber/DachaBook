import { quantityText } from './consumables'
import { workTimes } from './applications'
import { purchasePlan } from './purchases'
import type { Consumable, PlanWork, PlantUse } from './types'

export function sameUse(a: PlantUse, b: PlantUse): boolean {
  return a.plantGroupId === b.plantGroupId && a.workKind === b.workKind
}

/** Добавляет связку, если такой пары «группа + вид работ» у материала ещё нет. */
export function withUse(uses: PlantUse[], use: PlantUse): PlantUse[] {
  return uses.some((item) => sameUse(item, use)) ? uses : [...uses, use]
}

export function withoutUse(uses: PlantUse[], use: PlantUse): PlantUse[] {
  return uses.filter((item) => !sameUse(item, use))
}

/** Переименование вида работ в связках. Если две связки сходятся в одну, остаётся первая. */
export function renamePlantUses(uses: PlantUse[] | undefined, from: string, to: string): PlantUse[] {
  const next: PlantUse[] = []
  for (const use of uses ?? []) {
    const renamed = use.workKind === from ? { plantGroupId: use.plantGroupId, workKind: to } : use
    if (!next.some((item) => sameUse(item, renamed))) next.push(renamed)
  }
  return next
}

export interface FertilizerLine {
  consumableId: string
  name: string
  active: boolean
  plantGroupId: string
  groupName: string
  workKind: string
  /** Сколько раз за сезон в плане есть работа этого вида с этой группой. Ноль — такой работы нет. */
  times: number
  perUse?: number
  need?: number
  measureUnit: string
  formula?: string
  warnings: string[]
}

type WorkSlice = Pick<PlanWork, 'deletedAt' | 'active' | 'workKind' | 'plantGroupIds' | 'recurrence' | 'periods' | 'seasonSchedule'>

/**
 * Сколько материала нужно группе по связке «группа — вид работ — материал».
 * Площадь — у группы, норма — у материала, число внесений — сумма работ плана этого вида, где группа выбрана.
 */
export function fertilizerLines(input: {
  consumables: Consumable[]
  groups: { id: string; name: string; areaM2?: number; deletedAt?: string }[]
  works: WorkSlice[]
  today: string
  plantGroupId?: string
  workKind?: string
  consumableId?: string
}): FertilizerLine[] {
  const lines: FertilizerLine[] = []
  for (const item of input.consumables) {
    if (item.deletedAt) continue
    if (input.consumableId && item.id !== input.consumableId) continue
    for (const use of item.plantUses ?? []) {
      if (input.plantGroupId && use.plantGroupId !== input.plantGroupId) continue
      if (input.workKind && use.workKind !== input.workKind) continue
      const group = input.groups.find((entry) => entry.id === use.plantGroupId && !entry.deletedAt)
      if (!group) continue
      const matched = input.works.filter((work) => !work.deletedAt && work.active && work.workKind === use.workKind && work.plantGroupIds.includes(group.id))
      const times = matched.reduce((sum, work) => sum + workTimes(work, input.today), 0)
      const base = {
        consumableId: item.id,
        name: item.name,
        active: item.active,
        plantGroupId: group.id,
        groupName: group.name,
        workKind: use.workKind,
        times,
        measureUnit: item.unit,
      }
      if (!item.ratePerM2) {
        lines.push({ ...base, warnings: ['У материала не задана норма на 1 м² — количество не считается.'] })
        continue
      }
      const plan = purchasePlan({
        unit: item.unit,
        ratePerM2: item.ratePerM2,
        rateUnit: item.rateUnit,
        applications: times,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        areas: [{ name: group.name, areaM2: group.areaM2 }],
        areaKind: 'groups',
        usedThisYear: 0,
        pastUsage: [],
      })
      lines.push({
        ...base,
        perUse: plan.perUse,
        need: plan.need,
        measureUnit: plan.measureUnit || item.unit,
        formula: plan.formula,
        warnings: plan.warnings,
      })
    }
  }
  return lines.sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru') || a.workKind.localeCompare(b.workKind, 'ru') || a.name.localeCompare(b.name, 'ru'))
}

/** Короткая строка для списка групп: материал, вид работ и количество. */
export function fertilizerSummary(line: FertilizerLine): string {
  const name = line.active ? line.name : `${line.name} (архив)`
  if (line.need !== undefined) return `${name} · ${line.workKind}: ${quantityText(line.need, line.measureUnit)} за сезон`
  if (line.perUse !== undefined) return `${name} · ${line.workKind}: на один раз ${quantityText(line.perUse, line.measureUnit)}`
  return `${name} · ${line.workKind}: количество не посчитано`
}
