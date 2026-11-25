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

/** Заменяет связку целиком (норма и кратность для группы) или добавляет новую. */
export function replaceUse(uses: PlantUse[], use: PlantUse): PlantUse[] {
  const index = uses.findIndex((item) => sameUse(item, use))
  if (index < 0) return [...uses, use]
  const next = [...uses]
  next[index] = use
  return next
}

export function withoutUse(uses: PlantUse[], use: PlantUse): PlantUse[] {
  return uses.filter((item) => !sameUse(item, use))
}

/** Переименование вида работ в связках. Если две связки сходятся в одну, остаётся первая. */
export function renamePlantUses(uses: PlantUse[] | undefined, from: string, to: string): PlantUse[] {
  const next: PlantUse[] = []
  for (const use of uses ?? []) {
    const renamed = use.workKind === from ? { ...use, workKind: to } : use
    if (!next.some((item) => sameUse(item, renamed))) next.push(renamed)
  }
  return next
}

/** Норма связки: своя или общая у материала. */
export function useRate(use: PlantUse, item: Pick<Consumable, 'ratePerM2' | 'rateUnit'>): { ratePerM2?: number; rateUnit?: string } {
  return {
    ratePerM2: use.ratePerM2 ?? item.ratePerM2,
    rateUnit: use.rateUnit ?? item.rateUnit,
  }
}

/** Кратность из инструкции материала: график или число «раз за сезон». */
export function instructionApplications(
  item: Pick<Consumable, 'applications' | 'instructionRecurrence' | 'instructionPeriods' | 'instructionSchedule'>,
  today: string,
): number | undefined {
  if (item.instructionRecurrence === 'season' && item.instructionSchedule) {
    const times = workTimes({ recurrence: 'season', periods: [], seasonSchedule: item.instructionSchedule }, today)
    return times > 0 ? times : undefined
  }
  if (item.instructionRecurrence === 'yearly' && (item.instructionPeriods?.length ?? 0) > 0) {
    return workTimes({ recurrence: 'yearly', periods: item.instructionPeriods ?? [], seasonSchedule: undefined }, today)
  }
  return item.applications && item.applications > 0 ? item.applications : undefined
}

/** Кратность для связки: своя, иначе из инструкции материала. */
export function useApplications(
  use: PlantUse,
  item: Pick<Consumable, 'applications' | 'instructionRecurrence' | 'instructionPeriods' | 'instructionSchedule'>,
  today: string,
): number | undefined {
  if (use.applications && use.applications > 0) return use.applications
  return instructionApplications(item, today)
}

export interface FertilizerLine {
  consumableId: string
  name: string
  active: boolean
  plantGroupId: string
  groupName: string
  workKind: string
  /** Сколько раз за сезон: из инструкции связки или из плана. Ноль — не задано. */
  times: number
  /** Норма на м², по которой посчитана строка (своя у группы или общая). */
  ratePerM2?: number
  rateUnit?: string
  /** Кратность из инструкции связки, если задана отдельно от плана. */
  instructedTimes?: number
  perUse?: number
  need?: number
  measureUnit: string
  formula?: string
  warnings: string[]
}

type WorkSlice = Pick<PlanWork, 'deletedAt' | 'active' | 'workKind' | 'plantGroupIds' | 'objectIds' | 'recurrence' | 'periods' | 'seasonSchedule'>

type GroupSlice = { id: string; name: string; areaM2?: number; objectIds?: string[]; deletedAt?: string }

/**
 * Работы плана для связки «группа + вид».
 * Сначала работы, где группа выбрана явно — так нет двойного учёта, если рядом есть работа только по объекту.
 * Если таких нет — работы того же вида только по объектам этой группы (миграция со старых планов).
 */
export function worksForPlantUse(works: WorkSlice[], group: GroupSlice, workKind: string): WorkSlice[] {
  const live = works.filter((work) => !work.deletedAt && work.active && work.workKind === workKind)
  const withGroup = live.filter((work) => work.plantGroupIds.includes(group.id))
  if (withGroup.length > 0) return withGroup
  const objectIds = group.objectIds ?? []
  if (objectIds.length === 0) return []
  return live.filter((work) => work.plantGroupIds.length === 0 && work.objectIds.some((id) => objectIds.includes(id)))
}

/**
 * Сколько материала нужно группе по связке «группа — вид работ — материал».
 * Площадь — у группы растений; норма и кратность — у связки (с запасным вариантом из карточки материала и плана).
 * Объект участка сам по себе норму не даёт: на нём могут быть разные культуры.
 */
export function fertilizerLines(input: {
  consumables: Consumable[]
  groups: GroupSlice[]
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
      const matched = worksForPlantUse(input.works, group, use.workKind)
      const fromPlan = matched.reduce((sum, work) => sum + workTimes(work, input.today), 0)
      const instructed = useApplications(use, item, input.today)
      const times = instructed && instructed > 0 ? instructed : fromPlan
      const { ratePerM2, rateUnit } = useRate(use, item)
      const base = {
        consumableId: item.id,
        name: item.name,
        active: item.active,
        plantGroupId: group.id,
        groupName: group.name,
        workKind: use.workKind,
        times,
        ratePerM2,
        rateUnit,
        instructedTimes: instructed,
        measureUnit: item.unit,
      }
      if (!ratePerM2) {
        lines.push({ ...base, warnings: ['У материала не задана норма на 1 м² — количество не считается.'] })
        continue
      }
      const plan = purchasePlan({
        unit: item.unit,
        ratePerM2,
        rateUnit,
        applications: times,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        areas: [{ name: group.name, areaM2: group.areaM2 }],
        areaKind: 'groups',
        usedThisYear: 0,
        pastUsage: [],
      })
      const warnings = [...plan.warnings]
      if (times === 0) {
        // purchasePlan already warns; keep
      } else if (instructed && fromPlan > 0 && instructed !== fromPlan) {
        warnings.push(`В инструкции связки ${instructed} раз(а), в плане работ этого вида — ${fromPlan}. Для покупки взята инструкция.`)
      }
      lines.push({
        ...base,
        perUse: plan.perUse,
        need: plan.need,
        measureUnit: plan.measureUnit || item.unit,
        formula: plan.formula,
        warnings,
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
