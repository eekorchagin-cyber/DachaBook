import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { navigate } from '../app/router'
import { repo } from '../app/store'
import { fertilizerSummary } from '../domain/careLinks'
import { includesAllWords } from '../domain/diaryFilter'
import { OBJECT_TYPES } from '../domain/labels'
import type { CareObject, DocInput, ObjectType, PlantGroup } from '../domain/types'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { PhotoFields } from '../ui/PhotoFields'
import { SearchButton, SearchQuery } from '../ui/SearchDialog'
import { ActionButton } from '../ui/Section'
import { useFertilizerLines } from './useFertilizerLines'
import { WorkLinks } from './WorkLinks'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru')

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function ObjectForm({ object, onClose }: { object?: CareObject; onClose: () => void }) {
  const [name, setName] = useState(object?.name ?? '')
  const [type, setType] = useState<ObjectType>(object?.type ?? 'garden')
  const [area, setArea] = useState(object?.areaM2?.toString() ?? '')
  const [count, setCount] = useState(object?.plantCount?.toString() ?? '')
  const [location, setLocation] = useState(object?.location ?? '')
  const [description, setDescription] = useState(object?.description ?? '')
  const [photoIds, setPhotoIds] = useState(object?.photoIds ?? [])
  const [fileNotes, setFileNotes] = useState(object?.fileNotes ?? {})

  const save = async (active = object?.active ?? true) => {
    const input: DocInput<CareObject> = {
      name: name.trim(),
      type,
      areaM2: numberOrUndefined(area),
      plantCount: numberOrUndefined(count),
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      photoIds,
      fileNotes,
      active,
    }
    if (object) await repo.update('objects', object.id, input, object.revision)
    else await repo.create('objects', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{object ? 'Изменить объект' : 'Новый объект'}</h2>
      <label className="field">
        Название
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        Тип
        <select value={type} onChange={(event) => setType(event.target.value as ObjectType)}>
          {Object.entries(OBJECT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label className="field">
          Площадь, м²
          <input inputMode="decimal" value={area} onChange={(event) => setArea(event.target.value)} />
        </label>
        <label className="field">
          Растений, шт.
          <input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} />
        </label>
      </div>
      <label className="field">
        Где находится
        <input value={location} onChange={(event) => setLocation(event.target.value)} />
      </label>
      <label className="field">
        Описание
        <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <h3 className="section-title">Фотографии</h3>
      <PhotoFields ids={photoIds} notes={fileNotes} onChange={(ids, notes) => { setPhotoIds(ids); setFileNotes(notes) }} />
      {object && <WorkLinks objectId={object.id} returnPath={`/objects?object=${object.id}`} />}
      {object && <ObjectGroups objectId={object.id} />}
      <div className="actions">
        <ActionButton disabled={!name.trim()} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {object && (
          <ActionButton secondary onRun={() => save(!object.active)}>
            {object.active ? 'В архив' : 'Вернуть из архива'}
          </ActionButton>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

function ObjectGroups({ objectId }: { objectId: string }) {
  const groups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt && group.objectIds.includes(objectId)).toArray(), [objectId]) ?? []
  return (
    <p className="hint">
      Растения: {groups.length > 0 ? groups.map((group) => group.name).sort((a, b) => a.localeCompare(b, 'ru')).join(', ') : 'группы не привязаны'}. Привязка меняется на вкладке «Группы растений».
    </p>
  )
}

function GroupForm({ group, objects, fromDictionaries, onClose }: { group?: PlantGroup; objects: CareObject[]; fromDictionaries?: boolean; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [objectIds, setObjectIds] = useState<string[]>(group?.objectIds ?? [])
  const [area, setArea] = useState(group?.areaM2?.toString() ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [photoIds, setPhotoIds] = useState(group?.photoIds ?? [])
  const [fileNotes, setFileNotes] = useState(group?.fileNotes ?? {})
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const save = async (active = group?.active ?? true) => {
    const input: DocInput<PlantGroup> = {
      name: name.trim(),
      objectIds,
      areaM2: numberOrUndefined(area),
      description: description.trim() || undefined,
      photoIds,
      fileNotes,
      active,
    }
    if (group) await repo.update('plantGroups', group.id, input, group.revision)
    else await repo.create('plantGroups', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{group ? 'Изменить группу растений' : 'Новая группа растений'}</h2>
      <label className="field">
        Название (например, «Хвойные», «Ягодные кусты»)
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="choice">
        <legend>Где растут</legend>
        {objects.map((object) => (
          <label key={object.id}>
            <input type="checkbox" checked={objectIds.includes(object.id)} onChange={() => toggle(object.id)} />
            {object.name}
          </label>
        ))}
      </fieldset>
      <label className="field">
        Площадь, м²
        <input inputMode="decimal" placeholder="Например: 40" aria-label="Площадь группы" value={area} onChange={(event) => setArea(event.target.value)} />
      </label>
      <p className="hint">Это площадь самих растений, а не всего места, где они растут. По ней считается удобрение, когда группа связана с видом работ и материалом.</p>
      <label className="field">
        Описание, сорта
        <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <h3 className="section-title">Фотографии</h3>
      <PhotoFields ids={photoIds} notes={fileNotes} onChange={(ids, notes) => { setPhotoIds(ids); setFileNotes(notes) }} />
      {group ? (
        <WorkLinks plantGroupId={group.id} returnPath={`/objects?view=groups&group=${group.id}${fromDictionaries ? '&from=dictionaries' : ''}`} />
      ) : (
        <p className="hint">Сохраните группу, затем кнопкой «Добавить работу» откроется план с уже отмеченной группой.</p>
      )}
      <div className="actions">
        <ActionButton disabled={!name.trim()} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {group && (
          <ActionButton secondary onRun={() => save(!group.active)}>
            {group.active ? 'В архив' : 'Вернуть из архива'}
          </ActionButton>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

/** fromDictionaries — открыт из «Ещё → Справочники»: стрелка назад ведёт туда. returnTo — вернуться в карточку материала. */
export function ObjectsScreen({
  initialView = 'objects',
  fromDictionaries = false,
  initialGroupId,
  initialObjectId,
  returnTo,
}: {
  initialView?: 'objects' | 'groups'
  fromDictionaries?: boolean
  initialGroupId?: string
  initialObjectId?: string
  returnTo?: string
}) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const loadedGroups = useLiveQuery(() => db.plantGroups.filter((item) => !item.deletedAt).toArray(), [])
  const groups = loadedGroups ?? []
  const fertilizer = useFertilizerLines() ?? []
  const [view, setView] = useState<'objects' | 'groups'>(initialGroupId ? 'groups' : initialView)
  const [editing, setEditing] = useState<{ kind: 'object' | 'group'; id?: string } | null>(
    initialObjectId ? { kind: 'object', id: initialObjectId } : initialGroupId ? { kind: 'group', id: initialGroupId } : null,
  )
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing, view])

  const active = objects.filter((item) => item.active).sort(byName)
  const groupsOf = (objectId: string) => groups.filter((group) => group.objectIds.includes(objectId)).sort(byName).map((group) => (group.active ? group.name : `${group.name} (архив)`))
  const archived = objects.filter((item) => !item.active).sort(byName)
  const close = () => {
    if (returnTo && ((editing?.kind === 'group' && editing.id === initialGroupId) || (editing?.kind === 'object' && editing.id === initialObjectId))) {
      navigate(returnTo)
      return
    }
    setEditing(null)
  }

  if (editing) {
    if (editing.kind === 'group' && editing.id && !loadedGroups) {
      return (
        <Screen title="Объекты и растения" help="objects" onBack={close} tab={fromDictionaries ? '/more' : '/objects'}>
          <p className="hint">Загрузка…</p>
        </Screen>
      )
    }
    const group = editing.kind === 'group' ? groups.find((item) => item.id === editing.id) : undefined
    if (editing.kind === 'group' && editing.id && loadedGroups && !group) {
      return (
        <Screen title="Объекты и растения" help="objects" onBack={close} tab={fromDictionaries ? '/more' : '/objects'}>
          <p className="hint">Такой группы нет.</p>
        </Screen>
      )
    }
    return (
      <Screen title="Объекты и растения" help="objects" onBack={close} tab={fromDictionaries ? '/more' : '/objects'}>
        {editing.kind === 'object' ? (
          <ObjectForm key={editing.id ?? 'new'} object={objects.find((item) => item.id === editing.id)} onClose={close} />
        ) : (
          <GroupForm key={editing.id ?? 'new'} group={group} objects={active} fromDictionaries={fromDictionaries} onClose={close} />
        )}
      </Screen>
    )
  }

  return (
    <Screen title="Объекты и растения" help="objects" back={fromDictionaries ? '/dictionaries' : undefined} tab={fromDictionaries ? '/more' : '/objects'}>
      <div className="segmented" role="tablist" aria-label="Что показать">
        <button type="button" role="tab" aria-selected={view === 'objects'} className={view === 'objects' ? 'active' : ''} onClick={() => setView('objects')}>
          Объекты ухода ({active.length})
        </button>
        <button type="button" role="tab" aria-selected={view === 'groups'} className={view === 'groups' ? 'active' : ''} onClick={() => setView('groups')}>
          Группы растений ({groups.length})
        </button>
      </div>

      {view === 'objects' ? (
        <>
          <div className="actions">
            <button type="button" className="button" onClick={() => setEditing({ kind: 'object' })}>
              + Добавить объект
            </button>
            <SearchButton query={query} label="Поиск по объектам" placeholder="Например: газон" onFind={setQuery} />
          </div>
          <SearchQuery query={query} onClear={() => setQuery('')} />
          <p className="hint">Газон, сад, грядки и места на участке. Нажмите на объект, чтобы изменить его или убрать в архив.</p>
          {active.length === 0 && <EmptyState>Добавьте газон, сад, грядки или место на участке.</EmptyState>}
          <ul className="list">
            {active.filter((object) => includesAllWords(query, object.name)).map((object) => (
              <li key={object.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ kind: 'object', id: object.id })}>
                  <strong>{object.name}</strong>
                  <span className="muted">
                    {OBJECT_TYPES[object.type]}
                    {object.areaM2 !== undefined && `, ${object.areaM2} м²`}
                    {object.plantCount !== undefined && `, ${object.plantCount} шт.`}
                  </span>
                  {groupsOf(object.id).length > 0 && <span className="small">Растения: {groupsOf(object.id).join(', ')}</span>}
                </button>
              </li>
            ))}
          </ul>
          {archived.length > 0 && (
            <>
              <h2 className="section-title">Архив</h2>
              <ul className="list">
                {archived.map((object) => (
                  <li key={object.id}>
                    <button type="button" className="list-item" onClick={() => setEditing({ kind: 'object', id: object.id })}>
                      <strong>{object.name}</strong>
                      <span className="muted">в архиве, история сохранена</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <div className="actions">
            <button type="button" className="button" onClick={() => setEditing({ kind: 'group' })}>
              + Добавить группу
            </button>
            <SearchButton query={query} label="Поиск по группам растений" placeholder="Например: хвойные" onFind={setQuery} />
          </div>
          <SearchQuery query={query} onClear={() => setQuery('')} />
          <p className="hint">Группы растений («Хвойные», «Ягодные кусты», «Гортензии») привязываются к объектам. Площадь и связка с видом работ и материалом дают количество удобрения.</p>
          {groups.length === 0 && <EmptyState>Групп растений пока нет.</EmptyState>}
          <ul className="list">
            {[...groups].filter((group) => includesAllWords(query, group.name)).sort(byName).map((group) => (
              <li key={group.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ kind: 'group', id: group.id })}>
                  <strong>
                    {group.name}
                    {!group.active && ' (архив)'}
                  </strong>
                  <span className="muted">
                    {[group.objectIds.map((id) => objects.find((item) => item.id === id)?.name).filter(Boolean).join(', ') || 'без привязки к объекту', group.areaM2 !== undefined ? `${group.areaM2} м²` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {fertilizer.some((line) => line.plantGroupId === group.id) && (
                    <span className="small">{fertilizer.filter((line) => line.plantGroupId === group.id).map((line) => fertilizerSummary(line)).join('; ')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  )
}
