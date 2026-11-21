import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { formatDate } from '../../domain/dates'
import { albumPhotos } from '../../domain/album'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'
import { PhotoThumb } from './EventCard'

const PAGE = 48

/** Альбом: фото записей дневника. Нажатие открывает запись, а не оригинал. */
export function AlbumScreen() {
  const events = useLiveQuery(() => db.events.toArray(), [])
  const photos = useMemo(() => albumPhotos(events ?? []), [events])
  const [limit, setLimit] = useState(PAGE)
  const years = useMemo(() => [...new Set(photos.map((photo) => photo.date.slice(0, 4)))].sort().reverse(), [photos])
  const [year, setYear] = useState<string | null>(null)
  const shown = (year ? photos.filter((photo) => photo.date.startsWith(year)) : photos).slice(0, limit)
  const total = year ? photos.filter((photo) => photo.date.startsWith(year)).length : photos.length

  return (
    <Screen title="Альбом" help="album" back="/diary" tab="/diary">
      <p className="hint">Фото из записей дневника. Нажмите — откроется сама запись. Показываются уменьшенные копии.</p>
      {years.length > 1 && (
        <div className="jump-row" role="group" aria-label="Год">
          <button type="button" className={!year ? 'chip active' : 'chip'} onClick={() => { setYear(null); setLimit(PAGE) }}>
            Все
          </button>
          {years.map((item) => (
            <button
              key={item}
              type="button"
              className={item === year ? 'chip active' : 'chip'}
              onClick={() => {
                setYear(item)
                setLimit(PAGE)
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      {events && photos.length === 0 && <EmptyState>В дневнике пока нет фотографий.</EmptyState>}
      {total > 0 && <p className="muted small">Фото: {total}</p>}
      <div className="album-grid">
        {shown.map((photo) => (
          <a key={`${photo.eventId}-${photo.fileId}`} className="album-cell" href={`#/diary/${photo.eventId}`} title={photo.excerpt || formatDate(photo.date)}>
            <PhotoThumb id={photo.fileId} />
            <span className="album-date">{formatDate(photo.date)}</span>
          </a>
        ))}
      </div>
      {total > limit && (
        <button type="button" className="button secondary" onClick={() => setLimit((value) => value + PAGE)}>
          Показать ещё
        </button>
      )}
    </Screen>
  )
}
