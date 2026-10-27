import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { repo } from '../app/store'
import { db } from '../storage/db'
import { markDone, setSeason, transferDraft, undoMark } from './actions'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('перенос черновика в план работ', () => {
  it('работа переносится один раз со сроками и объектами, наблюдение — не переносится', async () => {
    const draft = await repo.create('planDrafts', {
      itemType: 'work',
      periods: [{ month: 5, week: 2 }],
      text: 'Подкормка газона Фертикой весенней',
      objectIds: ['lawn'],
      plantGroupIds: [],
      fileIds: [],
      seasonsDone: [2024, 2025],
      transferred: false,
    })
    const work = await transferDraft(draft)
    expect(work).toMatchObject({ title: 'Подкормка газона Фертикой весенней', periods: [{ month: 5, week: 2 }], objectIds: ['lawn'], workKind: 'Подкормка', recurrence: 'yearly', sourceDraftId: draft.id })
    const updated = (await db.planDrafts.get(draft.id))!
    expect(updated.transferred).toBe(true)
    await expect(transferDraft(updated)).rejects.toThrow(/уже перенесена/)

    const observation = await repo.create('planDrafts', { ...draft, id: undefined, itemType: 'observation', text: 'Хосты уже большие', transferred: false })
    await expect(transferDraft(observation)).rejects.toThrow(/Наблюдения/)
  })

  it('отметка сезона ставится и снимается без потери других сезонов', async () => {
    const work = await repo.create('planWorks', { title: 'Обрезка', objectIds: [], plantGroupIds: [], recurrence: 'yearly', periods: [{ month: 4 }], seasons: { '2025': { status: 'done', date: '2025-04-10' } }, active: true })
    await setSeason(work.id, '2026', { status: 'skipped' })
    expect((await db.planWorks.get(work.id))?.seasons).toEqual({ '2025': { status: 'done', date: '2025-04-10' }, '2026': { status: 'skipped' } })
    await setSeason(work.id, '2026', null)
    expect((await db.planWorks.get(work.id))?.seasons).toEqual({ '2025': { status: 'done', date: '2025-04-10' } })
  })

  it('короткая отметка ставится на дату и снимается, не затирая прошлый год', async () => {
    const work = await repo.create('planWorks', {
      title: 'Полив',
      objectIds: [],
      plantGroupIds: [],
      recurrence: 'season',
      periods: [],
      seasonSchedule: { fromMonth: 5, fromDay: 10, toMonth: 9, toDay: 5, weekdays: [1, 3, 5] },
      doneDates: ['2025-06-02'],
      seasons: {},
      active: true,
    })
    await markDone(work.id, '2026-05-11')
    await markDone(work.id, '2026-05-11')
    expect((await db.planWorks.get(work.id))?.doneDates).toEqual(['2025-06-02', '2026-05-11'])
    await undoMark(work.id, '2026')
    expect((await db.planWorks.get(work.id))?.doneDates).toEqual(['2025-06-02'])
  })
})
