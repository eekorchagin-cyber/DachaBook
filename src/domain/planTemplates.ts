import type { Consumable, DocInput, PlanTemplate, PlanTemplateItem, PlanWork } from './types'

/** Снимок работ плана в элементы шаблона; нормы материалов — по названию. */
export function itemsFromPlanWorks(works: PlanWork[], consumables: Consumable[]): PlanTemplateItem[] {
  const byId = new Map(consumables.map((item) => [item.id, item]))
  return works.map((work) => {
    const consumableRatesByName: PlanTemplateItem['consumableRatesByName'] = {}
    for (const [id, rate] of Object.entries(work.consumableRates ?? {})) {
      const name = byId.get(id)?.name?.trim()
      if (name) consumableRatesByName[name] = { quantity: rate.quantity, unit: rate.unit }
    }
    return {
      title: work.title,
      workKind: work.workKind,
      note: work.note,
      recurrence: work.recurrence,
      periods: work.periods,
      condition: work.condition,
      seasonSchedule: work.seasonSchedule,
      historyWords: work.historyWords,
      ...(Object.keys(consumableRatesByName).length ? { consumableRatesByName } : {}),
    }
  })
}

/** Вход для создания плановых работ из шаблона: группа и объекты подставляются на месте. */
export function planWorksFromTemplate(
  template: Pick<PlanTemplate, 'items'>,
  options: { plantGroupIds: string[]; objectIds?: string[]; consumables: Consumable[] },
): DocInput<PlanWork>[] {
  const byName = new Map(options.consumables.filter((item) => !item.deletedAt).map((item) => [item.name.trim().toLowerCase(), item]))
  return template.items.map((item) => {
    const consumableIds: string[] = []
    const consumableRates: PlanWork['consumableRates'] = {}
    for (const [name, rate] of Object.entries(item.consumableRatesByName ?? {})) {
      const match = byName.get(name.trim().toLowerCase())
      if (!match) continue
      consumableIds.push(match.id)
      consumableRates[match.id] = { quantity: rate.quantity, unit: rate.unit }
    }
    return {
      title: item.title,
      workKind: item.workKind,
      objectIds: options.objectIds ?? [],
      plantGroupIds: options.plantGroupIds,
      note: item.note,
      recurrence: item.recurrence,
      periods: item.periods,
      condition: item.condition,
      seasonSchedule: item.seasonSchedule,
      historyWords: item.historyWords,
      ...(consumableIds.length ? { consumableIds, consumableRates } : {}),
      seasons: {},
      active: true,
    }
  })
}
