import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import type { AppSettings } from '../../app/store'
import { filterEvents, type DiaryFilter } from '../../domain/diaryFilter'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'
import { EventCard } from './EventCard'

const PAGE = 50

export function DiaryScreen({ settings }: { settings: AppSettings }) {
  const events = useLiveQuery(() => db.events.toArray(), [])
  const loadedObjects = useLiveQuery(() => db.objects.toArray(), [])
  const objects = useMemo(() => loadedObjects ?? [], [loadedObjects])
  const groups = useLiveQuery(() => db.plantGroups.toArray(), []) ?? []
  const [filter, setFilter] = useState<DiaryFilter>({})
  const [showFilters, setShowFilters] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const objectMap = useMemo(() => new Map(objects.map((item) => [item.id, item])), [objects])
  const found = useMemo(() => filterEvents(events ?? [], filter), [events, filter])
  const set = (patch: Partial<DiaryFilter>) => {
    setFilter((current) => ({ ...current, ...patch }))
    setLimit(PAGE)
  }
  const activeFilters = [filter.from, filter.to, filter.objectId, filter.plantGroupId, filter.workKind, filter.type].filter(Boolean).length

  return (
    <Screen
      title="Дневник"
      help="diary"
      tab="/diary"
      actions={
        <a className="button small" href="#/diary/new">
          + Запись
        </a>
      }
    >
      <div className="search-row">
        <input
          type="search"
          placeholder="Поиск по тексту"
          value={filter.text ?? ''}
          onChange={(event) => set({ text: event.target.value })}
          aria-label="Поиск по тексту"
        />
        <button type="button" className="button secondary small" onClick={() => setShowFilters((value) => !value)}>
          Фильтры{activeFilters > 0 && ` (${activeFilters})`}
        </button>
      </div>
      {showFilters && (
        <section className="card filters">
          <div className="row">
            <label className="field">
              С даты
              <input type="date" value={filter.from ?? ''} onChange={(event) => set({ from: event.target.value || undefined })} />
            </label>
            <label className="field">
              По дату
              <input type="date" value={filter.to ?? ''} onChange={(event) => set({ to: event.target.value || undefined })} />
            </label>
          </div>
          <label className="field">
            Объект или место
            <select value={filter.objectId ?? ''} onChange={(event) => set({ objectId: event.target.value || undefined })}>
              <option value="">Все</option>
              {objects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Группа растений
            <select value={filter.plantGroupId ?? ''} onChange={(event) => set({ plantGroupId: event.target.value || undefined })}>
              <option value="">Все</option>
              {groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Вид работы
            <select value={filter.workKind ?? ''} onChange={(event) => set({ workKind: event.target.value || undefined })}>
              <option value="">Все</option>
              {settings.workKinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Тип записи
            <select value={filter.type ?? ''} onChange={(event) => set({ type: (event.target.value || undefined) as DiaryFilter['type'] })}>
              <option value="">Все</option>
              <option value="work">Работы</option>
              <option value="observation">Наблюдения</option>
              <option value="measurement">Измерения</option>
            </select>
          </label>
          <div className="actions">
            <button type="button" className="button secondary small" onClick={() => setFilter({ text: filter.text })}>
              Сбросить фильтры
            </button>
          </div>
        </section>
      )}
      {events && found.length === 0 && (
        <EmptyState>
          {events.length === 0 ? 'В дневнике пока нет записей. Нажмите «+ Запись» или импортируйте дневник из Evernote в разделе «Ещё».' : 'Ничего не найдено — измените поиск или фильтры.'}
        </EmptyState>
      )}
      <p className="muted small">{events && found.length > 0 && `Записей: ${found.length}`}</p>
      {found.slice(0, limit).map((event) => (
        <EventCard key={event.id} event={event} objects={objectMap} />
      ))}
      {found.length > limit && (
        <button type="button" className="button secondary" onClick={() => setLimit((value) => value + PAGE)}>
          Показать ещё
        </button>
      )}
    </Screen>
  )
}
