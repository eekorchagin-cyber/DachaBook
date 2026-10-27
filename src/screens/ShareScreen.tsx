import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../app/router'
import { repo } from '../app/store'
import { todayAtSite, formatDate } from '../domain/dates'
import { compareEvents } from '../domain/diaryFilter'
import { EVENT_TYPES } from '../domain/labels'
import { addPhoto, isImageFile } from '../files/files'
import { errorText } from '../lib/format'
import { addToInbox, clearInbox, readInbox, readInboxCaption, removeInboxItem, type InboxItem } from '../share/inbox'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const NONE: never[] = []

/** Фото из «Поделиться» (где ОС это умеет) или из Медиатеки: прикрепить к записи или создать новую. */
export function ShareScreen() {
  const events = useLiveQuery(() => db.events.filter((item) => !item.deletedAt).toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const objectMap = useMemo(() => new Map((objects ?? NONE).map((item) => [item.id, item])), [objects])
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [caption, setCaption] = useState('')
  const [date, setDate] = useState(() => todayAtSite().date)
  const [error, setError] = useState<string | null>(null)
  const photos = items ?? []

  const reload = async () => {
    setItems(await readInbox())
    setCaption((await readInboxCaption()) || '')
  }

  useEffect(() => {
    void readInbox().then(setItems)
    void readInboxCaption().then(setCaption)
  }, [])

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile)
      if (files.length === 0) return
      event.preventDefault()
      void addToInbox(files).then(() => reload())
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  const addFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter(isImageFile)
    if (list.length === 0) return
    await addToInbox(list)
    await reload()
  }

  const onDate = (events ?? NONE).filter((event) => event.date === date).sort(compareEvents)

  const storePhotos = async () => {
    const ids: string[] = []
    for (const item of photos) {
      const stored = await addPhoto(item.blob, item.name)
      if (!ids.includes(stored.id)) ids.push(stored.id)
    }
    await clearInbox()
    return ids
  }

  return (
    <Screen title="Фото в дневник" help="share" tab="/diary" back="/diary">
      <p className="hint">
        Выберите снимки в Медиатеке и добавьте их к записи этого дня или создайте новую. На iPhone DachaBook не появляется в «Поделиться» Медиатеки: Apple показывает там только программы из App Store, кнопка ниже открывает ту же Медиатеку. На Windows в установленном Chrome или Edge приложение будет в системном «Поделиться».
      </p>
      <div className="actions">
        <label className="button">
          Выбрать в Медиатеке
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {photos.length === 0 && <EmptyState>Фото пока не выбраны. На компьютере можно также вставить снимок сочетанием ⌘V / Ctrl+V.</EmptyState>}
      {photos.length > 0 && (
        <section className="card">
          <h2>Выбрано: {photos.length}</h2>
          <div className="photo-grid">
            {photos.map((item) => (
              <div key={item.key} className="photo-cell">
                <span className="thumb-wrap">
                  <InboxThumb blob={item.blob} />
                  <button
                    type="button"
                    className="thumb-remove"
                    aria-label="Убрать фото"
                    onClick={() => void removeInboxItem(item.key).then(() => reload())}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {photos.length > 0 && (
        <section className="card">
          <h2>Куда добавить</h2>
          <label className="field">
            Дата записи
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          {caption && (
            <p className="hint">Подпись из «Поделиться»: {caption}</p>
          )}
          {onDate.length === 0 && <p className="muted small">На эту дату записей нет — будет создана новая.</p>}
          {onDate.length > 0 && (
            <ul className="list">
              {onDate.map((event) => (
                <li key={event.id} className="list-row">
                  <span>
                    <strong>
                      {EVENT_TYPES[event.type].icon} {formatDate(event.date)}
                      {event.time && `, ${event.time}`}
                    </strong>
                    <span className="muted"> {event.objectIds.map((id) => objectMap.get(id)?.name).filter(Boolean).join(', ')}</span>
                    {event.comment && <span className="small muted"> · {event.comment.slice(0, 80)}</span>}
                  </span>
                  <ActionButton
                    secondary
                    onRun={async () => {
                      setError(null)
                      try {
                        const ids = await storePhotos()
                        await repo.update('events', event.id, { photoIds: [...event.photoIds, ...ids.filter((id) => !event.photoIds.includes(id))] }, event.revision)
                        navigate(`/diary/${event.id}`)
                      } catch (caught) {
                        setError(errorText(caught))
                      }
                    }}
                  >
                    Добавить сюда
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <ActionButton
              onRun={async () => {
                setError(null)
                try {
                  const ids = await storePhotos()
                  const text = caption ? `&comment=${encodeURIComponent(caption)}` : ''
                  navigate(`/diary/new?type=observation&photos=${ids.join(',')}${text}`)
                } catch (caught) {
                  setError(errorText(caught))
                }
              }}
            >
              Новая запись с этими фото
            </ActionButton>
            <button type="button" className="button secondary" onClick={() => void clearInbox().then(() => navigate('/diary'))}>
              Отмена
            </button>
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </Screen>
  )
}

function InboxThumb({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img className="thumb" src={url} alt="" />
}
