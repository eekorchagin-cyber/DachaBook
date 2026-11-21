import { describe, expect, it } from 'vitest'
import { itemsFromPlanWorks, planWorksFromTemplate } from './planTemplates'
import type { Consumable, PlanWork } from './types'

const meta = {
  id: 'w1',
  schemaVersion: 1 as const,
  revision: 'r1',
  baseRevision: undefined,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'Егор',
  updatedBy: 'Егор',
  checksum: 'x',
}

describe('шаблоны плана', () => {
  it('снимает работы без сезонных отметок и хранит нормы по названию', () => {
    const lime = {
      ...meta,
      id: 'c1',
      name: 'Известь',
      unit: 'кг',
      active: true,
    } as Consumable
    const work = {
      ...meta,
      title: 'Подкормка томатов',
      workKind: 'Подкормка',
      objectIds: ['o1'],
      plantGroupIds: ['g1'],
      recurrence: 'yearly',
      periods: [{ month: 5 }],
      consumableIds: ['c1'],
      consumableRates: { c1: { quantity: 50, unit: 'г' } },
      seasons: { '2026': { status: 'done', date: '2026-05-10' } },
      doneDates: ['2026-05-10'],
      active: true,
    } as PlanWork

    const items = itemsFromPlanWorks([work], [lime])
    expect(items).toEqual([
      expect.objectContaining({
        title: 'Подкормка томатов',
        workKind: 'Подкормка',
        recurrence: 'yearly',
        consumableRatesByName: { Известь: { quantity: 50, unit: 'г' } },
      }),
    ])
    expect(items[0]).not.toHaveProperty('seasons')
    expect(items[0]).not.toHaveProperty('doneDates')
  })

  it('применяет шаблон к группе и подставляет материалы по названию', () => {
    const lime = {
      ...meta,
      id: 'c-new',
      name: 'Известь',
      unit: 'кг',
      active: true,
    } as Consumable
    const inputs = planWorksFromTemplate(
      {
        items: [
          {
            title: 'Подкормка томатов',
            recurrence: 'yearly',
            periods: [{ month: 5 }],
            consumableRatesByName: { известь: { quantity: 50, unit: 'г' } },
          },
        ],
      },
      { plantGroupIds: ['g2'], objectIds: ['o2'], consumables: [lime] },
    )
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      title: 'Подкормка томатов',
      plantGroupIds: ['g2'],
      objectIds: ['o2'],
      consumableIds: ['c-new'],
      consumableRates: { 'c-new': { quantity: 50, unit: 'г' } },
      seasons: {},
      active: true,
    })
  })
})
