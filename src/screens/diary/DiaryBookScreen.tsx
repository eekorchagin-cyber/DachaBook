import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import type { AppSettings } from '../../app/store'
import { renderBookPdf, sharePdf, type PdfBook } from '../../diary/pdfBook'
import { quantityText } from '../../domain/consumables'
import { formatDate } from '../../domain/dates'
import { bookPhotoCount, bookRange, bookYears, diaryBook, type BookChapter } from '../../domain/diaryBook'
import { EVENT_TYPES, measurementText, weatherText } from '../../domain/labels'
import type { CareObject, Consumable, DiaryEvent, PlantGroup } from '../../domain/types'
import { useFileUrl } from '../../files/files'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'
import { WeatherBadge } from '../../ui/WeatherBadge'

const NONE: never[] = []

/** Предпросмотр книги дневника и сохранение в PDF через системный диалог печати. */
export function DiaryBookScreen({ settings }: { settings: AppSettings }) {
  const events = useLiveQuery(() => db.events.toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const groups = useLiveQuery(() => db.plantGroups.toArray(), [])
  const consumables = useLiveQuery(() => db.consumables.toArray(), [])
  const [year, setYear] = useState<number | 'all'>('all')
  const [printedAt] = useState(() => new Date().toLocaleDateString('ru-RU'))
  const live = events ?? NONE
  const years = useMemo(() => bookYears(live), [live])
  const chapters = useMemo(() => diaryBook(live, year === 'all' ? undefined : year), [live, year])
  const objectMap = useMemo(() => new Map((objects ?? NONE).map((item) => [item.id, item])), [objects])
  const groupMap = useMemo(() => new Map((groups ?? NONE).map((item) => [item.id, item])), [groups])
  const consumableMap = useMemo(() => new Map((consumables ?? NONE).map((item) => [item.id, item])), [consumables])
  const photos = bookPhotoCount(chapters)
  const entries = chapters.reduce((sum, chapter) => sum + chapter.months.reduce((monthSum, month) => monthSum + month.events.length, 0), 0)
  const savePdf = async () => {
    const thumbs = await loadThumbs(chapters)
    const blob = await renderBookPdf(toPdfBook(settings, chapters, objectMap, groupMap, consumableMap, printedAt, thumbs))
    await sharePdf(blob, `dachabook-dnevnik-${bookRange(chapters).replace('–', '-') || 'dnevnik'}.pdf`)
  }

  return (
    <Screen title="Дневник в PDF" help="book" tab="/diary" back="/diary">
      <div className="no-print">
        <p className="hint">
          Книга дневника: главы — годы, параграфы — месяцы. На iPhone после «Сохранить PDF» откроется «Поделиться» — выберите «Сохранить в Файлы». На компьютере файл
          скачается или откроется системное меню.
        </p>
        <div className="actions">
          <ActionButton disabled={entries === 0} onRun={savePdf}>
            Сохранить PDF
          </ActionButton>
        </div>
        {years.length > 1 && (
          <div className="jump-row" role="group" aria-label="Годы книги">
            <button type="button" className={year === 'all' ? 'chip active' : 'chip'} onClick={() => setYear('all')}>
              Все годы
            </button>
            {years.map((item) => (
              <button key={item} type="button" className={year === item ? 'chip active' : 'chip'} onClick={() => setYear(item)}>
                {item}
              </button>
            ))}
          </div>
        )}
        {entries > 0 && (
          <p className="muted small">
            Записей: {entries} · фото: {photos}
            {photos > 80 && ' · если телефон задумается, сохраните по одному году'}
          </p>
        )}
      </div>
      {events && entries === 0 && <EmptyState>В дневнике нет записей для выбранного периода.</EmptyState>}
      {entries > 0 && (
        <article className="book">
          <header className="book-cover">
            <p className="book-kicker">DachaBook</p>
            <h1>Дневник дачи</h1>
            {settings.plotAddress && <p className="book-place">{settings.plotAddress}</p>}
            <p>{settings.authorName}</p>
            <p>{bookRange(chapters)}</p>
            <p className="muted small">
              {entries} {entries === 1 ? 'запись' : entries < 5 ? 'записи' : 'записей'} · составлено {printedAt}
            </p>
          </header>
          {chapters.map((chapter) => (
            <section key={chapter.year} className="book-year">
              <h2>{chapter.title}</h2>
              {chapter.months.map((month) => (
                <section key={month.title} className="book-month">
                  <h3>{month.title}</h3>
                  {month.events.map((event) => (
                    <BookEntry key={event.id} event={event} objects={objectMap} groups={groupMap} consumables={consumableMap} />
                  ))}
                </section>
              ))}
            </section>
          ))}
        </article>
      )}
    </Screen>
  )
}

function BookEntry({
  event,
  objects,
  groups,
  consumables,
}: {
  event: DiaryEvent
  objects: Map<string, CareObject>
  groups: Map<string, PlantGroup>
  consumables: Map<string, Consumable>
}) {
  const type = EVENT_TYPES[event.type]
  const where = event.objectIds.map((id) => objects.get(id)?.name).filter(Boolean).join(', ')
  const plants = event.plantGroupIds.map((id) => groups.get(id)?.name).filter(Boolean).join(', ')
  return (
    <article className="book-entry">
      <header className="event-head">
        <span className="event-type" title={type.label}>
          {type.icon}
        </span>
        <strong>
          {formatDate(event.date)}
          {event.time && `, ${event.time}`}
        </strong>
        <span className="muted">{type.label}</span>
        {where && <span className="muted">{where}</span>}
        <WeatherBadge event={event} />
      </header>
      {plants && <p className="small muted">{plants}</p>}
      {event.workKind && <div className="tag">{event.workKind}</div>}
      {event.type === 'measurement' && <p>{measurementText(event)}</p>}
      {event.comment && <p className="book-text">{event.comment}</p>}
      {event.consumables && event.consumables.length > 0 && (
        <p className="small muted">
          Израсходовано:{' '}
          {event.consumables
            .map((use) => {
              const item = consumables.get(use.consumableId)
              return item ? `${item.name} — ${quantityText(use.quantity, item.unit)}` : quantityText(use.quantity, 'ед.')
            })
            .join('; ')}
        </p>
      )}
      {weatherText(event) && <p className="small muted">{weatherText(event)}</p>}
      {event.photoIds.length > 0 && (
        <div className="book-photos">
          {event.photoIds.map((id) => (
            <figure key={id}>
              <BookPhoto id={id} />
              {event.fileNotes?.[id] && <figcaption>{event.fileNotes[id]}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </article>
  )
}

function BookPhoto({ id }: { id: string }) {
  const url = useFileUrl(id, 'thumb')
  if (!url) return <span className="book-photo placeholder" />
  return <img className="book-photo" src={url} alt="" />
}

async function loadThumbs(chapters: BookChapter[]): Promise<Map<string, Blob>> {
  const ids = [...new Set(chapters.flatMap((chapter) => chapter.months.flatMap((month) => month.events.flatMap((event) => event.photoIds))))]
  const thumbs = new Map<string, Blob>()
  for (const id of ids) {
    const content = await db.fileContents.get(id)
    const blob = content?.thumb ?? content?.original
    if (blob) thumbs.set(id, blob)
  }
  return thumbs
}

function toPdfBook(
  settings: AppSettings,
  chapters: BookChapter[],
  objects: Map<string, CareObject>,
  groups: Map<string, PlantGroup>,
  consumables: Map<string, Consumable>,
  printedAt: string,
  thumbs: Map<string, Blob>,
): PdfBook {
  return {
    author: settings.authorName,
    place: settings.plotAddress || undefined,
    range: bookRange(chapters),
    printedAt,
    chapters: chapters.map((chapter) => ({
      title: chapter.title,
      months: chapter.months.map((month) => ({
        title: month.title,
        events: month.events.map((event) => {
          const extras = [
            event.type === 'measurement' ? measurementText(event) : '',
            event.consumables?.length
              ? `Израсходовано: ${event.consumables
                  .map((use) => {
                    const item = consumables.get(use.consumableId)
                    return item ? `${item.name} — ${quantityText(use.quantity, item.unit)}` : quantityText(use.quantity, 'ед.')
                  })
                  .join('; ')}`
              : '',
            weatherText(event) ?? '',
          ].filter(Boolean)
          return {
            dateLabel: `${formatDate(event.date)}${event.time ? `, ${event.time}` : ''}`,
            typeLabel: EVENT_TYPES[event.type].label,
            where: [
              event.objectIds.map((id) => objects.get(id)?.name).filter(Boolean).join(', '),
              event.plantGroupIds.map((id) => groups.get(id)?.name).filter(Boolean).join(', '),
            ]
              .filter(Boolean)
              .join(' · '),
            workKind: event.workKind,
            comment: event.comment,
            extras,
            photos: event.photoIds.flatMap((id) => {
              const blob = thumbs.get(id)
              return blob ? [{ blob, caption: event.fileNotes?.[id] }] : []
            }),
          }
        }),
      })),
    })),
  }
}
