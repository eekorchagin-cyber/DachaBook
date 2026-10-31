import { describe, expect, it } from 'vitest'
import { convertQuantity, parseApplications, pastYearUsage, purchaseLine, purchasePlan, substanceUnit, suggestedRateUnit } from './purchases'

describe('расчёт закупок', () => {
  it('одно внесение: 200 м² × 20 г/м² × 1 = 4 кг; из потребности вычитаются расход и запас', () => {
    const plan = purchasePlan({
      unit: 'кг',
      ratePerM2: 20,
      rateUnit: 'г',
      applications: 1,
      stockQuantity: 0.5,
      packQuantity: 1,
      areas: [{ name: 'Газон', areaM2: 200 }],
      usedThisYear: 1,
      pastUsage: [],
    })
    expect(plan).toMatchObject({ source: 'rate', perUse: 4, need: 4, used: 1, stock: 0.5, toBuy: 2.5, packs: 3 })
    expect(plan.formula).toBe('200 м² × 20 г/м² × 1 = 4 кг')
    expect(purchaseLine(plan, 'кг')).toBe('на один раз 4 кг · 200 м² × 20 г/м² × 1 = 4 кг · израсходовано 1 кг · запас 0,5 кг · купить 2,5 кг (3 уп.)')
  })

  it('три внесения за сезон утраивают килограммы, не упаковки в норме', () => {
    const plan = purchasePlan({
      unit: 'кг',
      ratePerM2: 20,
      rateUnit: 'г',
      applications: 3,
      stockQuantity: 0,
      packQuantity: 1,
      areas: [{ name: 'Газон', areaM2: 200 }],
      usedThisYear: 0,
      pastUsage: [],
    })
    expect(plan).toMatchObject({ perUse: 4, need: 12, toBuy: 12, packs: 12 })
    expect(plan.formula).toBe('200 м² × 20 г/м² × 3 = 12 кг')
  })

  it('без нормы берёт «на сезон», без него — максимум прошлых лет', () => {
    expect(purchasePlan({ unit: 'кг', seasonQuantity: 5, areas: [], usedThisYear: 5, stockQuantity: 0, pastUsage: [9] })).toMatchObject({
      source: 'season',
      need: 5,
      toBuy: 0,
      packs: undefined,
    })
    const history = purchasePlan({ unit: 'л', areas: [], usedThisYear: 0, stockQuantity: 0, pastUsage: [2, 3.5] })
    expect(history).toMatchObject({ source: 'history', need: 3.5, toBuy: 3.5 })
    expect(history.formula).toContain('3,5 л')
  })

  it('запас не задан — закупку не считает; объект без площади в сумму не входит', () => {
    const plan = purchasePlan({
      unit: 'кг',
      ratePerM2: 20,
      rateUnit: 'г',
      areas: [
        { name: 'Газон', areaM2: 100 },
        { name: 'Сад' },
      ],
      usedThisYear: 0,
      pastUsage: [],
    })
    expect(plan.need).toBe(2)
    expect(plan.toBuy).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('Сад')
    expect(purchaseLine(plan, 'кг')).toContain('укажите запас')
  })

  it('непереводимая единица нормы не портит запасной расчёт по сезону', () => {
    const plan = purchasePlan({
      unit: 'кг',
      ratePerM2: 1,
      rateUnit: 'шт.',
      seasonQuantity: 4,
      stockQuantity: 1,
      areas: [{ name: 'Газон', areaM2: 10 }],
      usedThisYear: 0,
      pastUsage: [],
    })
    expect(plan).toMatchObject({ source: 'season', need: 4, toBuy: 3 })
    expect(plan.warnings[0]).toContain('нельзя перевести')
  })

  it('переводит г и кг, мл и л; нулевой запас — это ноль, а не «не задан»', () => {
    expect(convertQuantity(20, 'г', 'кг')).toBe(0.02)
    expect(convertQuantity(1.5, 'л', 'мл')).toBe(1500)
    expect(convertQuantity(2, 'шт.', 'кг')).toBeNull()
    expect(suggestedRateUnit('кг')).toBe('г')
    expect(suggestedRateUnit('л')).toBe('мл')
    expect(suggestedRateUnit('уп.')).toBe('г')
    expect(suggestedRateUnit('шт.')).toBe('шт.')
    expect(substanceUnit('г', 'уп.')).toBe('кг')
    expect(substanceUnit('мл', 'уп.')).toBe('л')
    expect(parseApplications('3')).toBe(3)
    expect(parseApplications('1')).toBe(1)
    expect(parseApplications('')).toBeUndefined()
    expect(parseApplications('2,5')).toBeUndefined()
    expect(parseApplications('0')).toBeUndefined()
    expect(purchasePlan({ unit: 'кг', seasonQuantity: 2, stockQuantity: 0, packQuantity: 2, areas: [], usedThisYear: 0, pastUsage: [] })).toMatchObject({
      toBuy: 2,
      packs: 1,
    })
  })

  it('упаковка: 210 м² × 50 г × 4 внесения = 42 кг, это 4,2 единицы при 10 кг в одной', () => {
    const plan = purchasePlan({
      unit: 'ун.',
      packQuantity: 10,
      packUnit: 'кг',
      ratePerM2: 50,
      rateUnit: 'г',
      applications: 4,
      stockQuantity: 0,
      areas: [{ name: 'Газон', areaM2: 210 }],
      usedThisYear: 0,
      pastUsage: [],
    })
    expect(plan).toMatchObject({ source: 'rate', measureUnit: 'кг', perUse: 10.5, need: 42, unitsNeed: 4.2, toBuy: 4.2, packs: undefined })
    expect(plan.formula).toBe('210 м² × 50 г/м² × 4 = 42 кг')
  })

  it('ноль внесений из плана не считается как одно', () => {
    const plan = purchasePlan({
      unit: 'кг',
      ratePerM2: 20,
      rateUnit: 'г',
      applications: 0,
      stockQuantity: 0,
      areas: [{ name: 'Газон', areaM2: 200 }],
      usedThisYear: 0,
      pastUsage: [9],
    })
    expect(plan.perUse).toBe(4)
    expect(plan.need).toBeUndefined()
    expect(plan.toBuy).toBeUndefined()
    expect(plan.warnings.join(' ')).toContain('нет внесений')
  })

  it('прошлые годы не включают текущий и записи из корзины', () => {
    expect(
      pastYearUsage(
        [
          { date: '2024-05-01', consumables: [{ consumableId: 'a', quantity: 2 }] },
          { date: '2025-06-01', consumables: [{ consumableId: 'a', quantity: 1 }] },
          { date: '2026-06-01', consumables: [{ consumableId: 'a', quantity: 9 }] },
          { date: '2025-07-01', deletedAt: '2025-07-02', consumables: [{ consumableId: 'a', quantity: 8 }] },
          { date: '2025-08-01', consumables: [{ consumableId: 'b', quantity: 4 }] },
        ],
        'a',
        2026,
      ).sort(),
    ).toEqual([1, 2])
  })
})
