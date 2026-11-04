import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { localPath, navigate, useRoute } from '../app/router'
import { repo, useSettings } from '../app/store'
import { findConsumable, normalizeUrl, parseQuantity, quantityText, UNITS, urlHost, usageByConsumable } from '../domain/consumables'
import { todayAtSite } from '../domain/dates'
import { convertQuantity, purchasePlan, substanceUnit, suggestedRateUnit } from '../domain/purchases'
import type { CareObject, Consumable, DocInput, PlantGroup } from '../domain/types'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { SearchButton, SearchQuery } from '../ui/SearchDialog'
import { SuggestInput } from '../ui/SuggestInput'
import { ActionButton } from '../ui/Section'
import { includesAllWords } from '../domain/diaryFilter'
import { CareLinks } from './CareLinks'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru')

/** Группы растений из работ, где выбран материал: площадь для удобрений живёт у группы. */
function UsedInGroups({ consumableId, fromWork }: { consumableId: string; fromWork?: string }) {
  const works = useLiveQuery(
    () => db.planWorks.filter((work) => !work.deletedAt && (work.consumableIds ?? []).includes(consumableId)).toArray(),
    [consumableId],
  )
  const groups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt).toArray(), []) ?? []
  if (!works || works.length === 0) return null
  const ids = [...new Set(works.flatMap((work) => work.plantGroupIds))]
  const listed = ids
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is PlantGroup => !!group)
    .sort(byName)
  if (listed.length === 0) return null
  const back = encodeURIComponent(`/consumables?id=${consumableId}${fromWork ? `&work=${fromWork}` : ''}`)
  return (
    <div className="material-works">
      <p className="hint">Группы растений в работах с этим материалом. Площадь для удобрений задаётся у группы.</p>
      {listed.map((group) => (
        <a key={group.id} className="source-link" href={`#/objects?view=groups&group=${group.id}&back=${back}`}>
          Группа «{group.name}»
          {group.areaM2 !== undefined ? ` · ${group.areaM2} м²` : ' · площадь не указана'}
        </a>
      ))}
    </div>
  )
}

/** Один материал может быть в разных работах: уксус — хвойным и бойлеру, масло — газонокосилке. Норма на 1 раз у каждой работы своя. */
function UsedInWorks({ consumableId }: { consumableId: string }) {
  const works = useLiveQuery(
    () => db.planWorks.filter((work) => !work.deletedAt && (work.consumableIds ?? []).includes(consumableId)).toArray(),
    [consumableId],
  )
  const objects = useLiveQuery(() => db.objects.toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.toArray(), []) ?? []
  if (!works || works.length === 0) return null
  const nameOf = (ids: string[], source: { id: string; name: string }[]) => ids.map((id) => source.find((item) => item.id === id)?.name).filter(Boolean)
  const listed = [...works].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  return (
    <div className="material-works">
      <h3 className="section-title">Где используется</h3>
      <p className="hint">Норма на 1 раз задаётся в карточке работы. Один и тот же материал может быть и у группы растений, и у объекта.</p>
      {listed.map((work) => {
        const rate = work.consumableRates?.[consumableId]
        const where = [...nameOf(work.plantGroupIds, groups).map((name) => `группа «${name}»`), ...nameOf(work.objectIds, objects).map((name) => `объект «${name}»`)]
        const amount = rate ? `${quantityText(rate.quantity, rate.unit || '')} на 1 раз` : ''
        return (
          <p key={work.id}>
            <a className="source-link" href={`#/works?work=${work.id}&back=${encodeURIComponent(`/consumables?id=${consumableId}`)}`}>
              {work.title}
            </a>
            {where.length > 0 ? ` — ${where.join(', ')}` : ''}
            {amount ? `, ${amount}` : ''}
          </p>
        )
      })}
    </div>
  )
}

const num = (value: number | undefined) => (value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }))

function ConsumableForm({
  consumable,
  consumables,
  objects,
  fromWork,
  onClose,
}: {
  consumable?: Consumable
  consumables: Consumable[]
  objects: CareObject[]
  fromWork?: string
  onClose: () => void
}) {
  const [name, setName] = useState(consumable?.name ?? '')
  const [kind, setKind] = useState(consumable?.kind ?? '')
  const [unit, setUnit] = useState(consumable?.unit ?? 'кг')
  const [rate, setRate] = useState(consumable?.ratePerM2?.toString() ?? '')
  const [rateUnit, setRateUnit] = useState(consumable?.rateUnit ?? suggestedRateUnit(consumable?.unit ?? 'кг'))
  const [pack, setPack] = useState(consumable?.packQuantity?.toString() ?? '')
  const [objectIds, setObjectIds] = useState<string[]>(consumable?.objectIds ?? [])
  const [note, setNote] = useState(consumable?.note ?? '')
  const [description, setDescription] = useState(consumable?.description ?? '')
  const [url, setUrl] = useState(consumable?.url ?? '')
  const settings = useSettings()
  const units = settings?.consumableUnits ?? UNITS
  const kinds = settings?.consumableKinds ?? []
  const link = normalizeUrl(url)
  const duplicate = findConsumable(consumables, name)
  const nameTaken = !!duplicate && duplicate.id !== consumable?.id
  const rateInvalid = !!rate.trim() && parseQuantity(rate) === undefined
  const packInvalid = !!pack.trim() && parseQuantity(pack) === undefined
  const materialUnit = unit.trim() || 'шт.'
  const substance = substanceUnit(rateUnit, materialUnit)
  const separate = convertQuantity(1, materialUnit, substance) === null
  const plan = purchasePlan({
    unit: materialUnit,
    ratePerM2: parseQuantity(rate),
    rateUnit,
    applications: 1,
    packQuantity: parseQuantity(pack),
    packUnit: separate ? substance : undefined,
    areas: objects.filter((object) => objectIds.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 })),
    usedThisYear: 0,
    pastUsage: [],
  })
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  const changeUnit = (next: string) => {
    setRateUnit((current) => (current === suggestedRateUnit(unit) ? suggestedRateUnit(next) : current))
    setUnit(next)
  }

  const save = async (active = consumable?.active ?? true) => {
    const input: DocInput<Consumable> = {
      name: name.trim().replace(/\s+/g, ' '),
      unit: materialUnit,
      ratePerM2: parseQuantity(rate),
      rateUnit: parseQuantity(rate) ? rateUnit.trim() || 'г' : undefined,
      packQuantity: parseQuantity(pack),
      packUnit: separate && parseQuantity(pack) ? substance : undefined,
      objectIds,
      kind: kind || undefined,
      description: description.trim() || undefined,
      url: link ?? undefined,
      note: note.trim() || undefined,
      active,
    }
    if (consumable) {
      const fresh = await db.consumables.get(consumable.id)
      if (!fresh) return
      await repo.update('consumables', consumable.id, input, fresh.revision)
    }
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
      {kinds.length > 0 && (
        <label className="field">
          Вид материала
          <select aria-label="Вид материала" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Не указан</option>
            {kinds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
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
            Открыть ссылку
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
      <div className="calc-grid">
        <label className="field">
          Единица учёта
          <SuggestInput value={unit} options={units} onChange={changeUnit} ariaLabel="Единица учёта" />
        </label>
        <label className="field">
          {separate ? `В одной ${materialUnit}, ${substance}` : `В одной упаковке, ${materialUnit}`}
          <input aria-label="В одной единице учёта" inputMode="decimal" placeholder={separate ? 'Например: 10' : 'необязательно'} value={pack} onChange={(event) => setPack(event.target.value)} />
        </label>
        <label className="field span">
          Норма внесения на 1 м²
          <span className="measure-line">
            <input aria-label="Норма на 1 м²" inputMode="decimal" placeholder="Например: 50" value={rate} onChange={(event) => setRate(event.target.value)} />
            <select aria-label="Единица нормы" value={rateUnit} onChange={(event) => setRateUnit(event.target.value)}>
              {units.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <span className="suffix">/ м²</span>
          </span>
        </label>
        <label className="field">
          На 1 раз
          <span className="result-line">
            <input aria-label="На 1 раз" readOnly value={num(plan.perUse)} placeholder="—" />
            <span className="suffix">{plan.perUse === undefined ? '' : plan.measureUnit}</span>
          </span>
        </label>
        {rateInvalid && <p className="error span">Норма — положительное число, обычно в граммах.</p>}
        {packInvalid && <p className="error span">Содержимое одной единицы — положительное число.</p>}
        {plan.warnings.map((warning) => (
          <p key={warning} className="hint span">
            {warning}
          </p>
        ))}
        <p className="hint span">Сколько раз вносить и сколько купить на сезон считается в карточке работы, где выбран этот материал. Количество для группы растений — в связке ниже.</p>
      </div>
      {consumable ? (
        <CareLinks
          consumableId={consumable.id}
          returnPath={`/consumables?id=${consumable.id}`}
          draftConsumable={{
            unit: materialUnit,
            ratePerM2: parseQuantity(rate),
            rateUnit: parseQuantity(rate) ? rateUnit.trim() || 'г' : undefined,
            packQuantity: parseQuantity(pack),
            packUnit: separate && parseQuantity(pack) ? substance : undefined,
          }}
        />
      ) : (
        <p className="hint">Сохраните материал, затем свяжите его с группой растений и видом работ — так посчитается количество удобрения.</p>
      )}
      <label className="field">
        Примечание
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {consumable && <UsedInWorks consumableId={consumable.id} />}
      {consumable && <UsedInGroups consumableId={consumable.id} fromWork={fromWork} />}
      <div className="actions">
        <ActionButton disabled={!name.trim() || nameTaken || rateInvalid || packInvalid || link === null} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {consumable && (
          <ActionButton secondary onRun={() => save(!consumable.active)}>
            {consumable.active ? 'В архив' : 'Вернуть из архива'}
          </ActionButton>
        )}
        {consumable && (
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm(`Удалить «${consumable.name}»? Материал попадёт в «Ещё → Корзина»: оттуда его можно вернуть или убрать навсегда. Из плана работ он скроется. Расход в уже записанных днях дневника останется.`)) return
              await repo.remove('consumables', consumable.id, consumable.revision)
              onClose()
            }}
          >
            Удалить
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
  const loaded = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), [])
  const consumables = loaded ?? []
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const year = Number(todayAtSite().date.slice(0, 4))
  const loadedEvents = useLiveQuery(() => db.events.toArray(), [])
  const usage = useMemo(() => usageByConsumable(loadedEvents ?? [], year), [loadedEvents, year])
  const route = useRoute()
  const requested = route.query.get('id')
  const fromWork = route.query.get('work')
  const returnTo = localPath(route.query.get('back'))
  const [editing, setEditing] = useState<{ id?: string } | null>(requested ? { id: requested } : null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  const close = () => {
    setEditing(null)
    if (fromWork) navigate(`/works?work=${fromWork}`)
    else if (returnTo) navigate(returnTo)
    else if (requested) navigate('/consumables')
  }

  if (editing) {
    if (editing.id && !loaded) {
      return (
        <Screen title="Расходные материалы" help="consumables" onBack={close} tab="/more">
          <p className="hint">Загрузка…</p>
        </Screen>
      )
    }
    const consumable = consumables.find((item) => item.id === editing.id)
    if (editing.id && !consumable) {
      return (
        <Screen title="Расходные материалы" help="consumables" onBack={close} tab="/more">
          <p className="hint">Такого материала нет.</p>
        </Screen>
      )
    }
    return (
      <Screen title="Расходные материалы" help="consumables" onBack={close} tab="/more">
        <ConsumableForm key={editing.id ?? 'new'} consumable={consumable} consumables={consumables} objects={[...objects].sort(byName)} fromWork={fromWork ?? undefined} onClose={close} />
      </Screen>
    )
  }

  const objectNames = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const linked = (ids: string[]) => objects.filter((object) => ids.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 }))
  const active = consumables.filter((item) => item.active && includesAllWords(query, `${item.name} ${item.kind ?? ''} ${item.description ?? ''}`)).sort(byName)
  const archived = consumables.filter((item) => !item.active).sort(byName)

  return (
    <Screen title="Расходные материалы" help="consumables" back="/dictionaries" tab="/more">
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Добавить материал
        </button>
        <SearchButton query={query} label="Поиск по материалам" placeholder="Например: уксус" onFind={setQuery} />
      </div>
      <SearchQuery query={query} onClear={() => setQuery('')} />
      <p className="hint">
        Удобрения, средства защиты, семена, мульча. Здесь — само вещество: единица, фасовка и норма на м². Сколько внести за сезон считается в работе плана, где материал выбран.
      </p>
      {active.length === 0 && <EmptyState>Материалов пока нет. Добавьте их здесь или прямо в записи работы в дневнике.</EmptyState>}
      <ul className="list">
        {active.map((item) => {
          const used = usage.get(item.id) ?? 0
          const plan = purchasePlan({
            unit: item.unit,
            ratePerM2: item.ratePerM2,
            rateUnit: item.rateUnit,
            applications: 1,
            packQuantity: item.packQuantity,
            packUnit: item.packUnit,
            areas: linked(item.objectIds),
            usedThisYear: 0,
            pastUsage: [],
          })
          return (
            <li key={item.id}>
              <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                <strong>{item.name}</strong>
                <span className="muted">
                  {plan.perUse !== undefined ? `на один раз ${quantityText(plan.perUse, plan.measureUnit)}` : `единица: ${item.unit}`}
                  {` · израсходовано в ${year}: ${quantityText(used, item.unit)}`}
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
