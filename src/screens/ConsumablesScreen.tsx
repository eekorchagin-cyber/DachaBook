import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { repo, useSettings } from '../app/store'
import { findConsumable, normalizeUrl, parseNonNegative, parseQuantity, quantityText, UNITS, urlHost, usageByConsumable } from '../domain/consumables'
import { todayAtSite } from '../domain/dates'
import { pastYearUsage, purchaseLine, purchasePlan, suggestedRateUnit } from '../domain/purchases'
import type { CareObject, Consumable, DiaryEvent, DocInput } from '../domain/types'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { SuggestInput } from '../ui/SuggestInput'
import { ActionButton } from '../ui/Section'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru')

function ConsumableForm({
  consumable,
  consumables,
  objects,
  events,
  year,
  onClose,
}: {
  consumable?: Consumable
  consumables: Consumable[]
  objects: CareObject[]
  events: DiaryEvent[]
  year: number
  onClose: () => void
}) {
  const [name, setName] = useState(consumable?.name ?? '')
  const [unit, setUnit] = useState(consumable?.unit ?? 'кг')
  const [season, setSeason] = useState(consumable?.seasonQuantity?.toString() ?? '')
  const [rate, setRate] = useState(consumable?.ratePerM2?.toString() ?? '')
  const [rateUnit, setRateUnit] = useState(consumable?.rateUnit ?? suggestedRateUnit(consumable?.unit ?? 'кг'))
  const [stock, setStock] = useState(consumable?.stockQuantity?.toString() ?? '')
  const [pack, setPack] = useState(consumable?.packQuantity?.toString() ?? '')
  const [objectIds, setObjectIds] = useState<string[]>(consumable?.objectIds ?? [])
  const [note, setNote] = useState(consumable?.note ?? '')
  const [description, setDescription] = useState(consumable?.description ?? '')
  const [url, setUrl] = useState(consumable?.url ?? '')
  const units = useSettings()?.consumableUnits ?? UNITS
  const link = normalizeUrl(url)
  const duplicate = findConsumable(consumables, name)
  const nameTaken = !!duplicate && duplicate.id !== consumable?.id
  const seasonInvalid = !!season.trim() && parseQuantity(season) === undefined
  const rateInvalid = !!rate.trim() && parseQuantity(rate) === undefined
  const stockInvalid = !!stock.trim() && parseNonNegative(stock) === undefined
  const packInvalid = !!pack.trim() && parseQuantity(pack) === undefined
  const materialUnit = unit.trim() || 'шт.'
  const plan = purchasePlan({
    unit: materialUnit,
    seasonQuantity: parseQuantity(season),
    ratePerM2: parseQuantity(rate),
    rateUnit,
    stockQuantity: parseNonNegative(stock),
    packQuantity: parseQuantity(pack),
    areas: objects.filter((object) => objectIds.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 })),
    usedThisYear: consumable ? (usageByConsumable(events, year).get(consumable.id) ?? 0) : 0,
    pastUsage: consumable ? pastYearUsage(events, consumable.id, year) : [],
  })
  const preview = purchaseLine(plan, materialUnit)
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const save = async (active = consumable?.active ?? true) => {
    const input: DocInput<Consumable> = {
      name: name.trim().replace(/\s+/g, ' '),
      unit: materialUnit,
      seasonQuantity: parseQuantity(season),
      ratePerM2: parseQuantity(rate),
      rateUnit: parseQuantity(rate) ? rateUnit.trim() || materialUnit : undefined,
      stockQuantity: parseNonNegative(stock),
      packQuantity: parseQuantity(pack),
      objectIds,
      description: description.trim() || undefined,
      url: link ?? undefined,
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
          <SuggestInput value={unit} options={units} onChange={setUnit} />
        </label>
        <label className="field">
          Нужно на сезон
          <input inputMode="decimal" placeholder="необязательно" value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
      </div>
      {seasonInvalid && <p className="error">Количество на сезон — положительное число.</p>}
      <div className="row">
        <label className="field">
          Норма на 1 м²
          <input inputMode="decimal" placeholder="например, 20" value={rate} onChange={(event) => setRate(event.target.value)} />
        </label>
        <label className="field">
          Единица нормы
          <SuggestInput value={rateUnit} options={units} onChange={setRateUnit} />
        </label>
      </div>
      {rateInvalid && <p className="error">Норма — положительное число.</p>}
      <div className="row">
        <label className="field">
          Запас сейчас, {materialUnit}
          <input inputMode="decimal" placeholder="0 — ничего нет" value={stock} onChange={(event) => setStock(event.target.value)} />
        </label>
        <label className="field">
          В одной упаковке, {materialUnit}
          <input inputMode="decimal" placeholder="необязательно" value={pack} onChange={(event) => setPack(event.target.value)} />
        </label>
      </div>
      {stockInvalid && <p className="error">Запас — ноль или положительное число.</p>}
      {packInvalid && <p className="error">Упаковка — положительное число.</p>}
      <label className="field">
        Описание
        <textarea rows={3} placeholder="Что это и для чего: состав, действие, когда применять" value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className="field">
        Ссылка на источник в интернете
        <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      {link === null && <p className="error">Это не похоже на ссылку. Пример: https://fertika.ru/…</p>}
      {link && (
        <p className="small">
          <a className="source-link" href={link} target="_blank" rel="noopener noreferrer">
            Открыть {urlHost(link)}
          </a>
        </p>
      )}
      {objects.length > 0 && (
        <fieldset className="chips">
          <legend>Для каких объектов</legend>
          {objects
            .filter((object) => object.active || objectIds.includes(object.id))
            .map((object) => (
              <label key={object.id} className={objectIds.includes(object.id) ? 'chip active' : 'chip'}>
                <input type="checkbox" checked={objectIds.includes(object.id)} onChange={() => toggle(object.id)} />
                {object.name}
                {object.areaM2 ? ` · ${object.areaM2} м²` : ''}
              </label>
            ))}
        </fieldset>
      )}
      {preview && <p className="notice">{preview}</p>}
      {plan.warnings.map((warning) => (
        <p key={warning} className="hint">
          {warning}
        </p>
      ))}
      <label className="field">
        Примечание (норма, фасовка, где купить)
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="actions">
        <ActionButton disabled={!name.trim() || nameTaken || seasonInvalid || rateInvalid || stockInvalid || packInvalid || link === null} onRun={() => save()}>
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
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const year = Number(todayAtSite().date.slice(0, 4))
  const loadedEvents = useLiveQuery(() => db.events.toArray(), [])
  const events = loadedEvents ?? []
  const usage = useMemo(() => usageByConsumable(loadedEvents ?? [], year), [loadedEvents, year])
  const [editing, setEditing] = useState<{ id?: string } | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  if (editing) {
    return (
      <Screen title="Расходные материалы" help="consumables" onBack={() => setEditing(null)} tab="/more">
        <ConsumableForm
          key={editing.id ?? 'new'}
          consumable={consumables.find((item) => item.id === editing.id)}
          consumables={consumables}
          objects={[...objects].sort(byName)}
          events={events}
          year={year}
          onClose={() => setEditing(null)}
        />
      </Screen>
    )
  }

  const objectNames = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const linked = (ids: string[]) => objects.filter((object) => ids.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 }))
  const active = consumables.filter((item) => item.active).sort(byName)
  const archived = consumables.filter((item) => !item.active).sort(byName)

  return (
    <Screen title="Расходные материалы" help="consumables" back="/dictionaries" tab="/more">
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Добавить материал
        </button>
      </div>
      <p className="hint">
        Удобрения, средства защиты, семена, мульча. Норма на м² и площадь объекта дают потребность на сезон; из неё вычитаются расход этого года и запас.
      </p>
      {active.length === 0 && <EmptyState>Материалов пока нет. Добавьте их здесь или прямо в записи работы в дневнике.</EmptyState>}
      <ul className="list">
        {active.map((item) => {
          const used = usage.get(item.id) ?? 0
          const plan = purchasePlan({
            unit: item.unit,
            seasonQuantity: item.seasonQuantity,
            ratePerM2: item.ratePerM2,
            rateUnit: item.rateUnit,
            stockQuantity: item.stockQuantity,
            packQuantity: item.packQuantity,
            areas: linked(item.objectIds),
            usedThisYear: used,
            pastUsage: pastYearUsage(events, item.id, year),
          })
          const line = purchaseLine(plan, item.unit)
          return (
            <li key={item.id}>
              <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                <strong>{item.name}</strong>
                <span className="muted">
                  {line ?? `единица: ${item.unit} · израсходовано в ${year}: ${quantityText(used, item.unit)}`}
                  {plan.need !== undefined && used > plan.need && ' — больше нормы'}
                </span>
                {item.objectIds.length > 0 && <span className="small">Для: {objectNames(item.objectIds)}</span>}
                {item.description && <span className="small">{item.description}</span>}
                {item.note && <span className="small">{item.note}</span>}
                {item.url && <span className="small muted">Источник: {urlHost(item.url)}</span>}
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
