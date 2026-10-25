import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { repo } from '../app/store'
import { findConsumable, parseQuantity, quantityText, UNITS, usageByConsumable } from '../domain/consumables'
import { todayAtSite } from '../domain/dates'
import type { CareObject, Consumable, DocInput } from '../domain/types'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru')

function ConsumableForm({ consumable, consumables, objects, onClose }: { consumable?: Consumable; consumables: Consumable[]; objects: CareObject[]; onClose: () => void }) {
  const [name, setName] = useState(consumable?.name ?? '')
  const [unit, setUnit] = useState(consumable?.unit ?? 'кг')
  const [season, setSeason] = useState(consumable?.seasonQuantity?.toString() ?? '')
  const [objectIds, setObjectIds] = useState<string[]>(consumable?.objectIds ?? [])
  const [note, setNote] = useState(consumable?.note ?? '')
  const duplicate = findConsumable(consumables, name)
  const nameTaken = !!duplicate && duplicate.id !== consumable?.id
  const seasonInvalid = !!season.trim() && parseQuantity(season) === undefined
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const save = async (active = consumable?.active ?? true) => {
    const input: DocInput<Consumable> = {
      name: name.trim().replace(/\s+/g, ' '),
      unit: unit.trim() || 'шт.',
      seasonQuantity: parseQuantity(season),
      objectIds,
      note: note.trim() || undefined,
      active,
    }
    if (consumable) await repo.update('consumables', consumable.id, input, consumable.revision)
    else await repo.create('consumables', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{consumable ? 'Изменить материал' : 'Новый расходный материал'}</h2>
      <label className="field">
        Название
        <input placeholder="Например, «Азофоска» или «Мульча из коры»" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {nameTaken && <p className="error">Материал с таким названием уже есть.</p>}
      <div className="row">
        <label className="field">
          Единица
          <input list="consumable-units" value={unit} onChange={(event) => setUnit(event.target.value)} />
          <datalist id="consumable-units">
            {UNITS.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Нужно на сезон
          <input inputMode="decimal" placeholder="необязательно" value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
      </div>
      {seasonInvalid && <p className="error">Количество на сезон — положительное число.</p>}
      {objects.length > 0 && (
        <fieldset className="chips">
          <legend>Для каких объектов</legend>
          {objects.map((object) => (
            <label key={object.id} className={objectIds.includes(object.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={objectIds.includes(object.id)} onChange={() => toggle(object.id)} />
              {object.name}
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        Примечание (норма, где купить, фасовка)
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="actions">
        <ActionButton disabled={!name.trim() || nameTaken || seasonInvalid} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {consumable && (
          <ActionButton secondary onRun={() => save(!consumable.active)}>
            {consumable.active ? 'В архив' : 'Вернуть из архива'}
          </ActionButton>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

export function ConsumablesScreen() {
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const year = Number(todayAtSite().date.slice(0, 4))
  const events = useLiveQuery(() => db.events.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).toArray(), [year])
  const usage = useMemo(() => usageByConsumable(events ?? [], year), [events, year])
  const [editing, setEditing] = useState<{ id?: string } | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  if (editing) {
    return (
      <Screen title="Расходные материалы" help="consumables" back="/more" tab="/more">
        <ConsumableForm
          key={editing.id ?? 'new'}
          consumable={consumables.find((item) => item.id === editing.id)}
          consumables={consumables}
          objects={[...objects].sort(byName)}
          onClose={() => setEditing(null)}
        />
      </Screen>
    )
  }

  const objectNames = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const active = consumables.filter((item) => item.active).sort(byName)
  const archived = consumables.filter((item) => !item.active).sort(byName)

  return (
    <Screen title="Расходные материалы" help="consumables" back="/more" tab="/more">
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Добавить материал
        </button>
      </div>
      <p className="hint">
        Удобрения, средства защиты, семена, мульча — всё, что расходуется на уход. Сколько ушло, указывается в записях работ дневника; по этим данным
        будут планироваться закупки.
      </p>
      {active.length === 0 && <EmptyState>Материалов пока нет. Добавьте их здесь или прямо в записи работы в дневнике.</EmptyState>}
      <ul className="list">
        {active.map((item) => {
          const used = usage.get(item.id) ?? 0
          return (
            <li key={item.id}>
              <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                <strong>{item.name}</strong>
                <span className="muted">
                  {item.seasonQuantity !== undefined ? `на сезон: ${quantityText(item.seasonQuantity, item.unit)}` : `единица: ${item.unit}`}
                  {` · израсходовано в ${year}: ${quantityText(used, item.unit)}`}
                  {item.seasonQuantity !== undefined && used > item.seasonQuantity && ' — больше нормы'}
                </span>
                {item.objectIds.length > 0 && <span className="small">Для: {objectNames(item.objectIds)}</span>}
                {item.note && <span className="small">{item.note}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {archived.length > 0 && (
        <>
          <h2 className="section-title">Архив</h2>
          <ul className="list">
            {archived.map((item) => (
              <li key={item.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                  <strong>{item.name}</strong>
                  <span className="muted">в архиве, расход в дневнике сохранён</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  )
}
