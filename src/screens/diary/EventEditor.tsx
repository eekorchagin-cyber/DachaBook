import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { repo, type AppSettings } from '../../app/store'
import { todayAtSite } from '../../domain/dates'
import type { DiaryEvent, DocInput, EventType } from '../../domain/types'
import { addAttachment, addPhoto } from '../../files/files'
import { moonPhase } from '../../domain/moon'
import { NoteField } from '../../ui/NoteField'
import { PhotoViewer } from '../../ui/PhotoViewer'
import { WeatherBadge } from '../../ui/WeatherBadge'
import { errorText } from '../../lib/format'
import { ConflictError } from '../../storage/repository'
import { db } from '../../storage/db'
import { AttachmentRow } from '../../ui/AttachmentRow'
import { Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'
import { EVENT_TYPES, weatherText } from '../../domain/labels'
import { makeParts, type PartDraft } from '../../import/parts'
import { splitSentences } from '../../import/split'
import { SplitEditor } from '../../ui/SplitEditor'
import { PhotoThumb } from './EventCard'
import { splitEvent } from './splitEvent'

interface Draft {
  type: EventType
  date: string
  time: string
  objectIds: string[]
  plantGroupIds: string[]
  workKind: string
  comment: string
  photoIds: string[]
  attachmentIds: string[]
  temperature: string
  moisture: string
  moistureScale: string
  fileNotes: Record<string, string>
}

function toDraft(event: DiaryEvent | undefined, type: EventType): Draft {
  const now = todayAtSite()
  return {
    type: event?.type ?? type,
    date: event?.date ?? now.date,
    time: event?.time ?? (type === 'measurement' ? now.time : ''),
    objectIds: event?.objectIds ?? [],
    plantGroupIds: event?.plantGroupIds ?? [],
    workKind: event?.workKind ?? '',
    comment: event?.comment ?? '',
    photoIds: event?.photoIds ?? [],
    attachmentIds: event?.attachmentIds ?? [],
    temperature: event?.measurement?.temperature?.value.toString() ?? '',
    moisture: event?.measurement?.moisture?.value.toString() ?? '',
    moistureScale: event?.measurement?.moisture?.scale ?? '',
    fileNotes: event?.fileNotes ?? {},
  }
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function toInput(draft: Draft, event?: DiaryEvent): DocInput<DiaryEvent> {
  const temperature = parseNumber(draft.temperature)
  const moisture = parseNumber(draft.moisture)
  return {
    type: draft.type,
    date: draft.date,
    time: draft.time || undefined,
    objectIds: draft.objectIds,
    plantGroupIds: draft.plantGroupIds,
    workKind: draft.type === 'work' && draft.workKind ? draft.workKind : undefined,
    comment: draft.comment.trim(),
    photoIds: draft.photoIds,
    attachmentIds: draft.attachmentIds,
    measurement:
      draft.type === 'measurement'
        ? {
            temperature: temperature !== undefined ? { value: temperature, unit: '°C' } : undefined,
            moisture: moisture !== undefined ? { value: moisture, scale: draft.moistureScale.trim() || 'не указана' } : undefined,
          }
        : undefined,
    fileNotes: cleanNotes(draft),
    weather: event?.weather,
    source: event?.source,
  }
}

/** Пояснения только к файлам, которые остались в записи, и без пустых. */
function cleanNotes(draft: Draft): Record<string, string> | undefined {
  const notes = Object.fromEntries(
    Object.entries(draft.fileNotes)
      .map(([id, text]) => [id, text.trim()] as const)
      .filter(([id, text]) => text && (draft.photoIds.includes(id) || draft.attachmentIds.includes(id))),
  )
  return Object.keys(notes).length > 0 ? notes : undefined
}

function problems(draft: Draft): string[] {
  const list: string[] = []
  if (!draft.date) list.push('укажите дату')
  if (draft.objectIds.length === 0) list.push('выберите объект или место')
  if (draft.type === 'measurement' && parseNumber(draft.temperature) === undefined && parseNumber(draft.moisture) === undefined) {
    list.push('введите температуру или влажность')
  }
  return list
}

export function EventEditor({ id, initialType, settings }: { id?: string; initialType: EventType; settings: AppSettings }) {
  const event = useLiveQuery(async () => (id ? ((await db.events.get(id)) ?? null) : null), [id])
  if (event === undefined) return null
  if (id && !event) {
    return (
      <Screen title="Запись дневника" tab="/diary" back="/diary">
        <p className="empty">Запись не найдена.</p>
      </Screen>
    )
  }
  return <EventForm key={event?.id ?? 'new'} event={event ?? undefined} initialType={initialType} settings={settings} />
}

function EventForm({ event, initialType, settings }: { event?: DiaryEvent; initialType: EventType; settings: AppSettings }) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const [draft, setDraft] = useState<Draft>(() => toDraft(event, initialType))
  const [initial, setInitial] = useState(() => JSON.stringify(toDraft(event, initialType)))
  const [error, setError] = useState<string | null>(null)
  const [splitParts, setSplitParts] = useState<PartDraft[] | null>(null)
  const [viewer, setViewer] = useState<number | null>(null)

  const dirty = useMemo(() => JSON.stringify(draft) !== initial, [draft, initial])

  useEffect(() => {
    if (!dirty) return
    const warn = (beforeUnload: BeforeUnloadEvent) => beforeUnload.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const toggle = (key: 'objectIds' | 'plantGroupIds', value: string) =>
    update({ [key]: draft[key].includes(value) ? draft[key].filter((item) => item !== value) : [...draft[key], value] })
  const leave = (path: string) => {
    if (!dirty || confirm('Изменения не сохранены. Выйти без сохранения?')) {
      setInitial(JSON.stringify(draft))
      navigate(path)
    }
  }
  const missing = problems(draft)

  const save = async () => {
    setError(null)
    try {
      if (event) await repo.update('events', event.id, toInput(draft, event), event.revision)
      else await repo.create('events', toInput(draft))
      setInitial(JSON.stringify(draft))
      navigate('/diary')
    } catch (caught) {
      setError(caught instanceof ConflictError ? 'Запись изменили в другом месте. Откройте её заново, чтобы не потерять чужую правку.' : errorText(caught))
    }
  }

  const addPhotos = async (files: FileList | null) => {
    const added: string[] = []
    for (const file of Array.from(files ?? [])) added.push((await addPhoto(file, file.name || 'photo.jpg')).id)
    setDraft((current) => ({ ...current, photoIds: [...current.photoIds, ...added.filter((item) => !current.photoIds.includes(item))] }))
  }

  const addFiles = async (files: FileList | null) => {
    const added: string[] = []
    for (const file of Array.from(files ?? [])) added.push((await addAttachment(file, file.name)).id)
    setDraft((current) => ({ ...current, attachmentIds: [...current.attachmentIds, ...added.filter((item) => !current.attachmentIds.includes(item))] }))
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru')
  const canSplitEvent = !!event && !dirty && draft.type !== 'measurement' && splitSentences(draft.comment).length > 1
  if (event && splitParts) {
    return (
      <Screen title="Разделить запись" help="event" tab="/diary" back="/diary">
        <section className="card">
          <p className="import-text">{event.comment}</p>
          <SplitEditor
            parts={splitParts}
            onChange={setSplitParts}
            onCancel={() => setSplitParts(null)}
            objects={objects.filter((item) => item.active).sort(byName)}
            groups={groups.filter((item) => item.active).sort(byName)}
            workKinds={settings.workKinds}
            hasMedia={event.photoIds.length + event.attachmentIds.length > 0}
          />
        </section>
        <div className="actions">
          <ActionButton
            disabled={splitParts.length < 2 || splitParts.some((part) => !part.text.trim())}
            onRun={async () => {
              await splitEvent(event, splitParts)
              navigate('/diary')
            }}
          >
            Разделить на {splitParts.length} записи
          </ActionButton>
        </div>
      </Screen>
    )
  }
  const activeObjects = objects.filter((item) => item.active || draft.objectIds.includes(item.id)).sort(byName)
  const activeGroups = groups.filter((item) => item.active || draft.plantGroupIds.includes(item.id)).sort(byName)

  return (
    <Screen title={event ? 'Запись дневника' : 'Новая запись'} help="event" tab="/diary" back="/diary">
      <section className="card">
        <div className="segmented" role="radiogroup" aria-label="Тип записи">
          {(Object.keys(EVENT_TYPES) as EventType[]).map((type) => (
            <button key={type} type="button" role="radio" aria-checked={draft.type === type} className={draft.type === type ? 'active' : ''} onClick={() => update({ type })}>
              {EVENT_TYPES[type].icon} {EVENT_TYPES[type].label}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="field">
            Дата события
            <input type="date" value={draft.date} onChange={(change) => update({ date: change.target.value })} />
          </label>
          <label className="field">
            Время (необязательно)
            <input type="time" value={draft.time} onChange={(change) => update({ time: change.target.value })} />
          </label>
        </div>
        <fieldset className="chips">
          <legend>Объект или место</legend>
          {activeObjects.map((item) => (
            <label key={item.id} className={draft.objectIds.includes(item.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={draft.objectIds.includes(item.id)} onChange={() => toggle('objectIds', item.id)} />
              {item.name}
            </label>
          ))}
        </fieldset>
        {activeGroups.length > 0 && (
          <fieldset className="chips">
            <legend>Группы растений</legend>
            {activeGroups.map((item) => (
              <label key={item.id} className={draft.plantGroupIds.includes(item.id) ? 'chip active' : 'chip'}>
                <input type="checkbox" checked={draft.plantGroupIds.includes(item.id)} onChange={() => toggle('plantGroupIds', item.id)} />
                {item.name}
              </label>
            ))}
          </fieldset>
        )}
        {draft.type === 'work' && (
          <label className="field">
            Вид работы
            <select value={draft.workKind} onChange={(change) => update({ workKind: change.target.value })}>
              <option value="">Не указан</option>
              {settings.workKinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
        )}
        {draft.type === 'measurement' && (
          <div className="row">
            <label className="field">
              Температура почвы, °C
              <input inputMode="decimal" value={draft.temperature} onChange={(change) => update({ temperature: change.target.value })} />
            </label>
            <label className="field">
              Влажность поверхности
              <input inputMode="decimal" value={draft.moisture} onChange={(change) => update({ moisture: change.target.value })} />
            </label>
            <label className="field">
              Шкала прибора
              <input placeholder="%, баллы 1–10…" value={draft.moistureScale} onChange={(change) => update({ moistureScale: change.target.value })} />
            </label>
          </div>
        )}
        <label className="field">
          Комментарий
          <textarea rows={4} value={draft.comment} onChange={(change) => update({ comment: change.target.value })} />
        </label>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Погода на участке</h2>
          <WeatherBadge event={{ date: draft.date || todayAtSite().date, weather: event?.weather }} />
        </div>
        {event?.weather ? (
          <p>☁ {weatherText(event)}</p>
        ) : (
          <dl className="facts">
            <dt>Осадки</dt>
            <dd>—</dd>
            <dt>Температура воздуха</dt>
            <dd>—</dd>
            <dt>Луна</dt>
            <dd>{draft.date ? moonPhase(draft.date).name : '—'}</dd>
          </dl>
        )}
        <p className="hint">
          На этапе 4 температура воздуха, осадки, влажность и ветер на дату и время записи будут подставляться автоматически из Open-Meteo и
          сохраняться в записи. Для записей задним числом — из архива погоды.
        </p>
      </section>

      <section className="card">
        <h2>Фотографии и файлы</h2>
        {draft.photoIds.length > 0 && (
          <div className="photo-grid">
            {draft.photoIds.map((photoId, index) => (
              <div key={photoId} className="photo-cell">
                <span className="thumb-wrap">
                  <PhotoThumb id={photoId} onClick={() => setViewer(index)} />
                  <button type="button" className="thumb-remove" aria-label="Убрать фото" onClick={() => update({ photoIds: draft.photoIds.filter((item) => item !== photoId) })}>
                    ×
                  </button>
                </span>
                <NoteField
                  placeholder="Пояснение"
                  value={draft.fileNotes[photoId] ?? ''}
                  onChange={(value) => update({ fileNotes: { ...draft.fileNotes, [photoId]: value } })}
                />
              </div>
            ))}
          </div>
        )}
        {viewer !== null && draft.photoIds.length > 0 && (
          <PhotoViewer ids={draft.photoIds} index={Math.min(viewer, draft.photoIds.length - 1)} notes={draft.fileNotes} onIndex={setViewer} onClose={() => setViewer(null)} />
        )}
        {draft.attachmentIds.length > 0 && (
          <ul className="list">
            {draft.attachmentIds.map((fileId) => (
              <AttachmentRow
                key={fileId}
                id={fileId}
                note={draft.fileNotes[fileId]}
                onNote={(value) => update({ fileNotes: { ...draft.fileNotes, [fileId]: value } })}
                onRemove={() => update({ attachmentIds: draft.attachmentIds.filter((item) => item !== fileId) })}
              />
            ))}
          </ul>
        )}
        <div className="actions">
          <label className="button secondary">
            Фото из галереи
            <input type="file" accept="image/*" multiple hidden onChange={(change) => void addPhotos(change.target.files)} />
          </label>
          <label className="button secondary">
            Камера
            <input type="file" accept="image/*" capture="environment" hidden onChange={(change) => void addPhotos(change.target.files)} />
          </label>
          <label className="button secondary">
            Файл
            <input type="file" multiple hidden onChange={(change) => void addFiles(change.target.files)} />
          </label>
        </div>
      </section>

      {event && (
        <p className="muted small">
          Создал(а): {event.createdBy}, {new Date(event.createdAt).toLocaleString('ru-RU')}. Изменил(а): {event.updatedBy}, {new Date(event.updatedAt).toLocaleString('ru-RU')}.
          {event.source && ' Импортировано из Evernote.'}
        </p>
      )}
      {missing.length > 0 && <p className="hint">Чтобы сохранить: {missing.join(', ')}.</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton disabled={missing.length > 0 || !dirty} onRun={save}>
          Сохранить
        </ActionButton>
        <button type="button" className="button secondary" onClick={() => leave('/diary')}>
          {dirty ? 'Отмена' : 'Закрыть'}
        </button>
        {canSplitEvent && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setSplitParts(makeParts(draft.comment, objects.filter((item) => item.active), groups.filter((item) => item.active), draft.type === 'work'))}
          >
            Разделить запись
          </button>
        )}
        {event && (
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm('Переместить запись в корзину? Её можно будет восстановить.')) return
              await repo.remove('events', event.id, event.revision)
              setInitial(JSON.stringify(draft))
              navigate('/diary')
            }}
          >
            В корзину
          </ActionButton>
        )}
      </div>
    </Screen>
  )
}
