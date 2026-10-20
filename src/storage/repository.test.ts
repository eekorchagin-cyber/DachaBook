import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DiaryEvent, DocInput } from '../domain/types'
import { DiaryDatabase } from './db'
import { canonicalJson, ConflictError, Repository, verifyChecksum } from './repository'

const event: DocInput<DiaryEvent> = {
  type: 'work',
  date: '2025-05-18',
  objectIds: ['lawn'],
  plantGroupIds: [],
  workKind: 'Подкормка',
  comment: 'Газон прочесал и удобрил',
  photoIds: [],
  attachmentIds: [],
}

let author = 'Егор'
let repo: Repository

beforeEach(() => {
  author = 'Егор'
  repo = new Repository(new DiaryDatabase(`test-${crypto.randomUUID()}`), () => author)
})

describe('canonicalJson', () => {
  it('не зависит от порядка ключей и пропускает undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe(canonicalJson({ a: { d: [2, { x: 2, y: 1 }] }, b: 1 }))
  })
})

describe('Repository', () => {
  it('создаёт документ со служебными полями и верной контрольной суммой', async () => {
    const doc = await repo.create('events', event)
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(doc.schemaVersion).toBe(1)
    expect(doc.createdBy).toBe('Егор')
    expect(doc.updatedBy).toBe('Егор')
    expect(await verifyChecksum(doc)).toBe(true)
    expect(await repo.get('events', doc.id)).toEqual(doc)
  })

  it('сохраняет переданный идентификатор и не создаёт дубль', async () => {
    const doc = await repo.create('events', { ...event, id: 'fixed-id' })
    expect(doc.id).toBe('fixed-id')
    await expect(repo.create('events', { ...event, id: 'fixed-id' })).rejects.toThrow(/уже существует/)
  })

  it('правка меняет ревизию, запоминает предыдущую и последнего редактора', async () => {
    const doc = await repo.create('events', event)
    author = 'Супруга'
    const next = await repo.update('events', doc.id, { comment: 'Исправлено' }, doc.revision)
    expect(next.comment).toBe('Исправлено')
    expect(next.revision).not.toBe(doc.revision)
    expect(next.baseRevision).toBe(doc.revision)
    expect(next.createdBy).toBe('Егор')
    expect(next.updatedBy).toBe('Супруга')
    expect(await verifyChecksum(next)).toBe(true)
  })

  it('правка от устаревшей ревизии не затирает новую', async () => {
    const doc = await repo.create('events', event)
    const first = await repo.update('events', doc.id, { comment: 'Первая правка' }, doc.revision)
    await expect(repo.update('events', doc.id, { comment: 'Вторая правка' }, doc.revision)).rejects.toBeInstanceOf(ConflictError)
    expect((await repo.get('events', doc.id))?.comment).toBe(first.comment)
  })

  it('удаление переносит в корзину, восстановление возвращает запись целиком', async () => {
    const doc = await repo.create('events', event)
    const deleted = await repo.remove('events', doc.id, doc.revision)
    expect(deleted.deletedAt).toBeTruthy()
    expect(deleted.comment).toBe(event.comment)
    const restored = await repo.restore('events', doc.id, deleted.revision)
    expect(restored.deletedAt).toBeUndefined()
    expect(await verifyChecksum(restored)).toBe(true)
  })

  it('обнаруживает повреждённое содержимое', async () => {
    const doc = await repo.create('events', event)
    expect(await verifyChecksum({ ...doc, comment: 'подменено' } as DiaryEvent)).toBe(false)
  })
})
