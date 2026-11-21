import { describe, expect, it } from 'vitest'
import { albumPhotos } from './album'

describe('альбом фотографий', () => {
  it('собирает фото записей по дате и пропускает удалённые', () => {
    const photos = albumPhotos([
      { id: 'e2', date: '2026-05-02', comment: 'Вторая', photoIds: ['p3'], createdAt: '2' },
      { id: 'e1', date: '2026-05-10', comment: 'Первая длинная запись про сад', photoIds: ['p1', 'p2'], createdAt: '1' },
      { id: 'e0', date: '2026-05-01', comment: 'Старая', photoIds: ['p0'], createdAt: '0', deletedAt: '2026-05-02' },
      { id: 'e3', date: '2026-04-01', comment: 'Без фото', photoIds: [], createdAt: '3' },
    ])
    expect(photos.map((item) => item.fileId)).toEqual(['p1', 'p2', 'p3'])
    expect(photos[0]).toMatchObject({ eventId: 'e1', date: '2026-05-10', excerpt: 'Первая длинная запись про сад' })
  })
})
