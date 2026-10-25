import { formatDate } from '../../domain/dates'
import { EVENT_TYPES, measurementText, weatherText } from '../../domain/labels'
import type { PhotoPosition } from '../../app/store'
import { quantityText } from '../../domain/consumables'
import type { CareObject, Consumable, DiaryEvent } from '../../domain/types'
import { useFileUrl } from '../../files/files'
import { WeatherBadge } from '../../ui/WeatherBadge'

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

export function EventCard({
  event,
  objects,
  consumables,
  photoPosition = 'right',
}: {
  event: DiaryEvent
  objects: Map<string, CareObject>
  consumables?: Map<string, Consumable>
  photoPosition?: PhotoPosition
}) {
  const type = EVENT_TYPES[event.type]
  const where = event.objectIds.map((id) => objects.get(id)?.name).filter(Boolean).join(', ')
  const side = photoPosition !== 'below' && event.photoIds.length > 0
  const shown = event.photoIds.slice(0, side ? 2 : 4)
  const more = event.photoIds.length - shown.length
  const photos = event.photoIds.length > 0 && (
    <div className={side ? 'event-photos side' : 'thumbs'}>
      {shown.map((id) => (
        <PhotoThumb key={id} id={id} />
      ))}
      {more > 0 && <span className="thumb more">+{more}</span>}
    </div>
  )
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
        <WeatherBadge event={event} />
      </div>
      <div className={side ? `event-body photos-${photoPosition}` : 'event-body'}>
        {side && photoPosition === 'left' && photos}
        <div className="event-main">
          {event.workKind && <div className="tag">{event.workKind}</div>}
          {event.type === 'measurement' && <p>{measurementText(event)}</p>}
          {event.weather && <p className="muted small">☁ {weatherText(event)}</p>}
          {event.comment && <p className="event-text">{event.comment}</p>}
          {event.consumables && event.consumables.length > 0 && (
            <p className="small muted">
              Израсходовано:{' '}
              {event.consumables
                .map((use) => {
                  const consumable = consumables?.get(use.consumableId)
                  return consumable ? `${consumable.name} — ${quantityText(use.quantity, consumable.unit)}` : quantityText(use.quantity, 'ед.')
                })
                .join('; ')}
            </p>
          )}
        </div>
        {side && photoPosition === 'right' && photos}
      </div>
      {!side && photos}
    </a>
  )
}
