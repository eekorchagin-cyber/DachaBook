import { formatDate } from '../../domain/dates'
import { EVENT_TYPES, measurementText, weatherText } from '../../domain/labels'
import type { CareObject, DiaryEvent } from '../../domain/types'
import { useFileUrl } from '../../files/files'

export function PhotoThumb({ id, onClick }: { id: string; onClick?: () => void }) {
  const url = useFileUrl(id, 'thumb')
  if (!url) return <span className="thumb placeholder" />
  return onClick ? (
    <button type="button" className="thumb-button" onClick={onClick}>
      <img className="thumb" src={url} alt="Фото" />
    </button>
  ) : (
    <img className="thumb" src={url} alt="Фото" />
  )
}

export function EventCard({ event, objects }: { event: DiaryEvent; objects: Map<string, CareObject> }) {
  const type = EVENT_TYPES[event.type]
  const where = event.objectIds.map((id) => objects.get(id)?.name).filter(Boolean).join(', ')
  return (
    <a className="event-card" href={`#/diary/${event.id}`}>
      <div className="event-head">
        <span className="event-type" title={type.label}>
          {type.icon}
        </span>
        <strong>
          {formatDate(event.date)}
          {event.time && `, ${event.time}`}
        </strong>
        <span className="muted">{where}</span>
      </div>
      {event.workKind && <div className="tag">{event.workKind}</div>}
      {event.type === 'measurement' && <p>{measurementText(event)}</p>}
      {event.weather && <p className="muted small">☁ {weatherText(event)}</p>}
      {event.comment && <p className="event-text">{event.comment}</p>}
      {event.photoIds.length > 0 && (
        <div className="thumbs">
          {event.photoIds.slice(0, 4).map((id) => (
            <PhotoThumb key={id} id={id} />
          ))}
        </div>
      )}
    </a>
  )
}
