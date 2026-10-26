import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { repo } from '../app/store'
import { db } from '../storage/db'
import { setSeason, transferDraft } from './actions'

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
})
