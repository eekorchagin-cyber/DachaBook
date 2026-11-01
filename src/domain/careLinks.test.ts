import { describe, expect, it } from 'vitest'
import { fertilizerLines, renamePlantUses, withUse, withoutUse } from './careLinks'
import type { Consumable, PlanWork, PlantUse } from './types'

const meta = {
  schemaVersion: 1,
  revision: 'r',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'test',
  updatedBy: 'test',
  checksum: 'x',
}

const material = (uses: PlantUse[], extra: Partial<Consumable> = {}): Consumable => ({
  ...meta,
  id: 'fert',
  name: 'Удобрение для гортензий',
  unit: 'кг',
  ratePerM2: 50,
  rateUnit: 'г',
  objectIds: [],
  plantUses: uses,
  active: true,
  ...extra,
})

const work = (extra: Partial<PlanWork> = {}): PlanWork => ({
  ...meta,
  id: 'w',
  title: 'Подкормка гортензий',
  objectIds: [],
  plantGroupIds: ['hydrangea'],
  workKind: 'Подкормка',
  recurrence: 'yearly',
  periods: [{ month: 5 }, { month: 6 }],
  seasons: {},
  active: true,
  ...extra,
})

const groups = [{ id: 'hydrangea', name: 'Гортензии', areaM2: 40 }]

describe('связка группа — вид работ — материал', () => {
  it('40 м² × 50 г/м² × 2 внесения из плана = 4 кг', () => {
    const [line] = fertilizerLines({
      consumables: [material([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }])],
      groups,
      works: [work()],
      today: '2026-11-01',
    })
    expect(line.times).toBe(2)
    expect(line.perUse).toBe(2)
    expect(line.need).toBe(4)
    expect(line.formula).toBe('40 м² × 50 г/м² × 2 = 4 кг')
  })

  it('без работы этого вида в плане показывает один раз и не умножает на сезон', () => {
    const [line] = fertilizerLines({
      consumables: [material([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }])],
      groups,
      works: [work({ workKind: 'Обрезка', periods: [{ month: 4 }] })],
      today: '2026-11-01',
    })
    expect(line.times).toBe(0)
    expect(line.perUse).toBe(2)
    expect(line.need).toBeUndefined()
    expect(line.warnings.join(' ')).toContain('на сезон не умножается')
  })

  it('работа без этой группы не входит в число внесений', () => {
    const [line] = fertilizerLines({
      consumables: [material([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }])],
      groups,
      works: [work({ plantGroupIds: ['conifers'] })],
      today: '2026-11-01',
    })
    expect(line.times).toBe(0)
    expect(line.need).toBeUndefined()
  })

  it('другая связка того же материала не подмешивает чужую площадь и вид', () => {
    const lines = fertilizerLines({
      consumables: [
        material([
          { plantGroupId: 'hydrangea', workKind: 'Подкормка' },
          { plantGroupId: 'conifers', workKind: 'Обрезка' },
        ]),
      ],
      groups: [...groups, { id: 'conifers', name: 'Хвойные', areaM2: 10 }],
      works: [work(), work({ id: 'cut', workKind: 'Обрезка', plantGroupIds: ['conifers'], periods: [{ month: 3 }] })],
      today: '2026-11-01',
      plantGroupId: 'hydrangea',
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].need).toBe(4)
    expect(lines[0].workKind).toBe('Подкормка')
  })

  it('без нормы и без площади говорит, чего не хватает', () => {
    const noRate = fertilizerLines({
      consumables: [material([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }], { ratePerM2: undefined })],
      groups,
      works: [],
      today: '2026-11-01',
    })
    expect(noRate[0].warnings.join(' ')).toContain('норма')
    const noArea = fertilizerLines({
      consumables: [material([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }])],
      groups: [{ id: 'hydrangea', name: 'Гортензии' }],
      works: [work({ periods: [{ month: 5 }] })],
      today: '2026-11-01',
    })
    expect(noArea[0].need).toBeUndefined()
    expect(noArea[0].warnings.join(' ')).toContain('групп')
  })

  it('добавление, снятие и переименование связки не плодят дубли', () => {
    const uses = withUse([{ plantGroupId: 'hydrangea', workKind: 'Подкормка' }], { plantGroupId: 'hydrangea', workKind: 'Подкормка' })
    expect(uses).toHaveLength(1)
    expect(withoutUse(uses, { plantGroupId: 'hydrangea', workKind: 'Подкормка' })).toEqual([])
    expect(
      renamePlantUses(
        [
          { plantGroupId: 'hydrangea', workKind: 'Подкормка' },
          { plantGroupId: 'hydrangea', workKind: 'Удобрение' },
        ],
        'Подкормка',
        'Удобрение',
      ),
    ).toEqual([{ plantGroupId: 'hydrangea', workKind: 'Удобрение' }])
  })
})
