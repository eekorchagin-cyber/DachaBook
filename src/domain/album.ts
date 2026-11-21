import type { DiaryEvent } from './types'

/** Фото в альбоме: уменьшенная копия, ссылка на запись дневника. */
export interface AlbumPhoto {
  fileId: string
  eventId: string
  date: string
  excerpt: string
}

/** Фотографии записей дневника по дате, новые сверху. Вложения без роли photo не входят. */
export function albumPhotos(events: Pick<DiaryEvent, 'id' | 'date' | 'comment' | 'photoIds' | 'deletedAt' | 'createdAt'>[]): AlbumPhoto[] {
  const photos: AlbumPhoto[] = []
  for (const event of events) {
    if (event.deletedAt || !event.photoIds?.length) continue
    const excerpt = event.comment.replace(/\s+/g, ' ').trim().slice(0, 80)
    for (const fileId of event.photoIds) {
      photos.push({ fileId, eventId: event.id, date: event.date, excerpt })
    }
  }
  return photos.sort((a, b) => b.date.localeCompare(a.date) || b.eventId.localeCompare(a.eventId))
}
