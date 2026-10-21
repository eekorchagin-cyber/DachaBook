import { useState } from 'react'
import { repo } from '../app/store'
import type { CareObject, PlantGroup } from '../domain/types'
import type { PartDraft } from '../import/parts'

export function SplitEditor(props: {
  parts: PartDraft[]
  onChange: (parts: PartDraft[]) => void
  onCancel: () => void
  objects: CareObject[]
  groups: PlantGroup[]
  workKinds: string[]
  hasMedia: boolean
}) {
  const { parts } = props
  const [busy, setBusy] = useState(false)
  const update = (index: number, patch: Partial<PartDraft>) => props.onChange(parts.map((part, i) => (i === index ? { ...part, ...patch } : part)))
  const mergeWithNext = (index: number) =>
    props.onChange([
      ...parts.slice(0, index),
      { ...parts[index], text: `${parts[index].text} ${parts[index + 1].text}`, withMedia: parts[index].withMedia || parts[index + 1].withMedia },
      ...parts.slice(index + 2),
    ])
  const addGroup = async (index: number) => {
    const name = prompt('Название новой группы растений (например, «Деревья», «Хвойные»):')?.trim()
    if (!name) return
    setBusy(true)
    try {
      const group = await repo.create('plantGroups', { name, objectIds: [parts[index].objectId].filter(Boolean), active: true })
      update(index, { plantGroupIds: [...parts[index].plantGroupIds, group.id] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="split-editor">
      <p className="hint">Каждая часть станет отдельной записью с той же датой. Проверьте тип, место и группы растений.</p>
      <ol className="split-parts">
        {parts.map((part, index) => (
          <li key={index} className="split-part">
            <textarea rows={2} value={part.text} onChange={(event) => update(index, { text: event.target.value })} aria-label={`Текст части ${index + 1}`} />
            <div className="row compact">
              <label className="field">
                Тип
                <select value={part.type} onChange={(event) => update(index, { type: event.target.value as PartDraft['type'] })}>
                  <option value="work">Работа</option>
                  <option value="observation">Наблюдение</option>
                </select>
              </label>
              <label className="field">
                Место
                <select value={part.objectId} onChange={(event) => update(index, { objectId: event.target.value })}>
                  {props.objects.map((object) => (
                    <option key={object.id} value={object.id}>
                      {object.name}
                    </option>
                  ))}
                </select>
              </label>
              {part.type === 'work' && (
                <label className="field">
                  Вид работы
                  <select value={part.workKind ?? ''} onChange={(event) => update(index, { workKind: event.target.value || undefined })}>
                    <option value="">Не указан</option>
                    {props.workKinds.map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="chips">
              {props.groups.map((group) => {
                const active = part.plantGroupIds.includes(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={active ? 'chip active' : 'chip'}
                    onClick={() =>
                      update(index, { plantGroupIds: active ? part.plantGroupIds.filter((id) => id !== group.id) : [...part.plantGroupIds, group.id] })
                    }
                  >
                    {group.name}
                  </button>
                )
              })}
              <button type="button" className="chip" disabled={busy} onClick={() => void addGroup(index)}>
                + группа растений
              </button>
            </div>
            <div className="actions">
              {props.hasMedia && (
                <label className="checkbox">
                  <input type="radio" checked={part.withMedia} onChange={() => props.onChange(parts.map((item, i) => ({ ...item, withMedia: i === index })))} />
                  Фото и файлы здесь
                </label>
              )}
              {index < parts.length - 1 && (
                <button type="button" className="button secondary small" onClick={() => mergeWithNext(index)}>
                  Объединить со следующей
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="button secondary small" onClick={props.onCancel}>
        Не разделять
      </button>
    </div>
  )
}
