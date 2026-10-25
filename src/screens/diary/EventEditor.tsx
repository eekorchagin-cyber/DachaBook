import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { repo, type AppSettings } from '../../app/store'
import { todayAtSite } from '../../domain/dates'
import { findConsumable, resolveUses, rowProblems, type ConsumableRow } from '../../domain/consumables'
import type { Consumable, ConsumableUse, DiaryEvent, DocInput, EventType } from '../../domain/types'
import { addAttachment, addPhoto, isImageFile } from '../../files/files'
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
  consumables: ConsumableRow[]
}

function toDraft(event: DiaryEvent | undefined, type: EventType, consumables: Consumable[]): Draft {
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
    consumables: (event?.consumables ?? []).map((use) => {
      const consumable = consumables.find((item) => item.id === use.consumableId)
      return { name: consumable?.name ?? 'Удалённый материал', quantity: use.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 3, useGrouping: false }), unit: consumable?.unit ?? '' }
    }),
  }
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function toInput(draft: Draft, event?: DiaryEvent, uses?: ConsumableUse[]): DocInput<DiaryEvent> {
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
    consumables: draft.type === 'work' && uses && uses.length > 0 ? uses : undefined,
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
  if (draft.type === 'work') list.push(...rowProblems(draft.consumables))
  return list
}

export function EventEditor({ id, initialType, settings }: { id?: string; initialType: EventType; settings: AppSettings }) {
  const event = useLiveQuery(async () => (id ? ((await db.events.get(id)) ?? null) : null), [id])
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), [])
  if (event === undefined || consumables === undefined) return null
  if (id && !event) {
    return (
      <Screen title="Запись дневника" tab="/diary" back="/diary">
        <p className="empty">Запись не найдена.</p>
      </Screen>
    )
  }
  return <EventForm key={event?.id ?? 'new'} event={event ?? undefined} initialType={initialType} settings={settings} consumables={consumables} />
}

function EventForm({ event, initialType, settings, consumables }: { event?: DiaryEvent; initialType: EventType; settings: AppSettings; consumables: Consumable[] }) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const [draft, setDraft] = useState<Draft>(() => toDraft(event, initialType, consumables))
  const [initial, setInitial] = useState(() => JSON.stringify(toDraft(event, initialType, consumables)))
  const [error, setError] = useState<string | null>(null)
  const [splitParts, setSplitParts] = useState<PartDraft[] | null>(null)
  const [viewer, setViewer] = useState<number | null>(null)
  const [processing, setProcessing] = useState(0)

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
      const uses =
        draft.type === 'work'
          ? await resolveUses(draft.consumables, consumables, (name, unit) => repo.create('consumables', { name, unit, objectIds: draft.objectIds, active: true }))
          : undefined
      if (event) await repo.update('events', event.id, toInput(draft, event, uses), event.revision)
      else await repo.create('events', toInput(draft, undefined, uses))
      setInitial(JSON.stringify(draft))
      navigate('/diary')
    } catch (caught) {
      setError(caught instanceof ConflictError ? 'Запись изменили в другом месте. Откройте её заново, чтобы не потерять чужую правку.' : errorText(caught))
    }
  }

  // Каждый файл добавляется в запись сразу после обработки; пока идёт обработка, сохранять нельзя.
  const addFilesTo = async (files: FileList | File[] | null, key: 'photoIds' | 'attachmentIds') => {
    const list = Array.from(files ?? [])
    setProcessing((count) => count + list.length)
    for (const file of list) {
      try {
        const stored = key === 'photoIds' ? await addPhoto(file, file.name || 'photo.jpg') : await addAttachment(file, file.name)
        setDraft((current) => (current[key].includes(stored.id) ? current : { ...current, [key]: [...current[key], stored.id] }))
      } catch (caught) {
        setError(`Не удалось добавить «${file.name}»: ${errorText(caught)}`)
      } finally {
        setProcessing((count) => count - 1)
      }
    }
  }
  const addPhotos = (files: FileList | null) => addFilesTo(files, 'photoIds')
  const addFiles = (files: FileList | null) => addFilesTo(files, 'attachmentIds')
  const [dragging, setDragging] = useState(false)
  const addDropped = useEffectEvent((files: File[]) => {
    void addFilesTo(files.filter(isImageFile), 'photoIds')
    void addFilesTo(files.filter((file) => !isImageFile(file)), 'attachmentIds')
  })

  // Перетаскивание из «Фото» и Finder в любое место записи и вставка скопированного фото (⌘V).
  useEffect(() => {
    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files')
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      addDropped(Array.from(event.dataTransfer?.files ?? []))
    }
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      addDropped(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
    }
  }, [])

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
        {draft.type === 'work' && <ConsumableRows rows={draft.consumables} consumables={consumables} units={settings.consumableUnits} onChange={(rows) => update({ consumables: rows })} />}
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

      {dragging && <div className="drop-overlay">Отпустите, чтобы добавить фото и файлы в запись</div>}
      <section className="card">
        <h2>Фотографии и файлы</h2>
        <p className="hint desktop-only">На компьютере фото можно перетащить сюда из «Фото» или Finder, а скопированное — вставить сочетанием ⌘V (Ctrl+V).</p>
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
        <ActionButton disabled={missing.length > 0 || !dirty || processing > 0} onRun={save}>
          Сохранить
        </ActionButton>
        {processing > 0 && <span className="hint">Обрабатываются файлы ({processing})…</span>}
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

function ConsumableRows({ rows, consumables, units, onChange }: { rows: ConsumableRow[]; consumables: Consumable[]; units: string[]; onChange: (rows: ConsumableRow[]) => void }) {
  const set = (index: number, patch: Partial<ConsumableRow>) => onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)))
  const names = consumables.filter((item) => item.active).map((item) => item.name).sort((a, b) => a.localeCompare(b, 'ru'))
  return (
    <fieldset className="consumables">
      <legend>Расходные материалы</legend>
      {rows.map((row, index) => {
        const known = findConsumable(consumables, row.name)
        return (
          <div key={index} className="consumable-row">
            <input aria-label="Материал" list="consumable-names" placeholder="Материал" value={row.name} onChange={(change) => set(index, { name: change.target.value })} />
            <input aria-label="Количество" inputMode="decimal" placeholder="Кол-во" value={row.quantity} onChange={(change) => set(index, { quantity: change.target.value })} />
            {known ? (
              <span className="consumable-unit">{known.unit}</span>
            ) : (
              <input aria-label="Единица" list="consumable-units" placeholder="ед." value={row.unit} onChange={(change) => set(index, { unit: change.target.value })} />
            )}
            <button type="button" className="icon-button" aria-label="Убрать материал" onClick={() => onChange(rows.filter((_, current) => current !== index))}>
              ×
            </button>
          </div>
        )
      })}
      <datalist id="consumable-names">
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="consumable-units">
        {units.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>
      <button type="button" className="button secondary" onClick={() => onChange([...rows, { name: '', quantity: '', unit: '' }])}>
        + Материал
      </button>
      {rows.some((row) => row.name.trim() && !findConsumable(consumables, row.name)) && (
        <p className="hint">Новые материалы добавятся в «Ещё → Справочники → Расходные материалы» при сохранении записи.</p>
      )}
    </fieldset>
  )
}
