import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { localPath, navigate, useRoute } from '../app/router'
import { repo, useSettings } from '../app/store'
import { findConsumable, normalizeUrl, parseQuantity, quantityText, UNITS, urlHost, usageByConsumable } from '../domain/consumables'
import { groupByPlace, suggestStorage } from '../domain/placeSuggestion'
import { todayAtSite } from '../domain/dates'
import { convertQuantity, purchasePlan, substanceUnit, suggestedRateUnit } from '../domain/purchases'
import type { CareObject, Consumable, DocInput, PlantGroup } from '../domain/types'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { SearchButton, SearchQuery } from '../ui/SearchDialog'
import { PlaceHint } from '../ui/PlaceHint'
import { SuggestInput } from '../ui/SuggestInput'
import { ActionButton } from '../ui/Section'
import { includesAllWords } from '../domain/diaryFilter'
import { CareLinks } from './CareLinks'
import { GrowingTextarea } from '../ui/GrowingTextarea'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ru')

const num = (value: number | undefined) => (value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }))

function ConsumableForm({
  consumable,
  consumables,
  objects,
  onClose,
}: {
  consumable?: Consumable
  consumables: Consumable[]
  objects: CareObject[]
  onClose: () => void
}) {
  const [name, setName] = useState(consumable?.name ?? '')
  const [kind, setKind] = useState(consumable?.kind ?? '')
  const [place, setPlace] = useState(consumable?.place ?? '')
  const [unit, setUnit] = useState(consumable?.unit ?? 'кг')
  const [rate, setRate] = useState(consumable?.ratePerM2?.toString() ?? '')
  const [rateUnit, setRateUnit] = useState(consumable?.rateUnit ?? suggestedRateUnit(consumable?.unit ?? 'кг'))
  const [pack, setPack] = useState(consumable?.packQuantity?.toString() ?? '')
  const [applications, setApplications] = useState(consumable?.applications?.toString() ?? '')
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
  const appsParsed = applications.trim() ? Number(applications.trim()) : undefined
  const appsInvalid = !!applications.trim() && (!Number.isFinite(appsParsed) || (appsParsed ?? 0) < 1 || !Number.isInteger(appsParsed))
  const materialUnit = unit.trim() || 'шт.'
  const substance = substanceUnit(rateUnit, materialUnit)
  const separate = convertQuantity(1, materialUnit, substance) === null
  const plantGroups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt).toArray(), []) ?? []
  const linkedGroupAreas = (consumable?.plantUses ?? [])
    .map((use) => plantGroups.find((group) => group.id === use.plantGroupId))
    .filter((group): group is PlantGroup => !!group)
    .map((group) => ({ name: group.name, areaM2: group.areaM2 }))
  const uniqueGroupAreas = [...new Map(linkedGroupAreas.map((area) => [area.name, area])).values()]
  const plan = purchasePlan({
    unit: materialUnit,
    ratePerM2: parseQuantity(rate),
    rateUnit,
    applications: appsParsed && appsParsed > 0 ? appsParsed : 1,
    packQuantity: parseQuantity(pack),
    packUnit: separate ? substance : undefined,
    areas: uniqueGroupAreas,
    areaKind: 'groups',
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
      applications: appsParsed && appsParsed > 0 ? appsParsed : undefined,
      packQuantity: parseQuantity(pack),
      packUnit: separate && parseQuantity(pack) ? substance : undefined,
      objectIds,
      kind: kind || undefined,
      place: place.trim() || undefined,
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

  const suggestion = nameTaken ? undefined : suggestStorage(name, consumables, { kind, kinds, exceptId: consumable?.id })
  const offer = suggestion && !place.trim() && (suggestion.place || (!kind && suggestion.kind)) ? suggestion : undefined
  const knownPlaces = [...new Set(consumables.flatMap((item) => (item.place?.trim() && item.id !== consumable?.id ? [item.place.trim()] : [])))].sort((a, b) => a.localeCompare(b, 'ru'))

  return (
    <section className="card">
      <h2 className="block-title">{consumable ? 'Изменить материал' : 'Новый расходный материал'}</h2>
      <label className="field">
        Название
        <input placeholder="Например, «Азофоска» или «Мульча из коры»" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {nameTaken && <p className="error">Материал с таким названием уже есть.</p>}
      {offer && (
        <PlaceHint
          suggestion={offer}
          applyKind={!kind}
          onAccept={() => {
            if (offer.place) setPlace(offer.place)
            if (!kind && offer.kind) setKind(offer.kind)
          }}
        />
      )}
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
        Где лежит
        <input
          aria-label="Где лежит"
          placeholder="Например, «Сарай, полка с удобрениями»"
          value={place}
          list="storage-places"
          onChange={(event) => setPlace(event.target.value)}
        />
        <datalist id="storage-places">
          {knownPlaces.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <label className="field">
        Описание
        <GrowingTextarea
          aria-label="Описание"
          rows={3}
          placeholder="Что это и для чего: состав, действие, когда применять. Нормы для разных культур можно уточнить в связках ниже."
          value={description}
          onChange={setDescription}
        />
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
      <div className="calc-grid">
        <label className="field">
          Единица учёта
          <SuggestInput value={unit} options={units} onChange={changeUnit} ariaLabel="Единица учёта" />
        </label>
        <label className="field">
          {separate ? `В одной ${materialUnit}, ${substance}` : `В одной упаковке, ${materialUnit}`}
          <input aria-label="В одной единице учёта" inputMode="decimal" placeholder={separate ? 'Например: 10' : 'необязательно'} value={pack} onChange={(event) => setPack(event.target.value)} />
        </label>
        <div className="field span">
          <span className="field-label">Норма внесения на 1 м² (по умолчанию)</span>
          <span className="measure-line">
            <input aria-label="Число нормы на 1 м²" inputMode="decimal" placeholder="50" value={rate} onChange={(event) => setRate(event.target.value)} />
            <select aria-label="Единица нормы" value={rateUnit} onChange={(event) => setRateUnit(event.target.value)}>
              {units.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <span className="suffix">/ м²</span>
          </span>
        </div>
        <label className="field">
          Раз за сезон (по умолчанию)
          <input aria-label="Раз за сезон" inputMode="numeric" placeholder="например: 3" value={applications} onChange={(event) => setApplications(event.target.value)} />
        </label>
        <label className="field">
          На 1 раз (по связанным группам)
          <span className="result-line">
            <input aria-label="На 1 раз" readOnly value={num(plan.perUse)} placeholder="—" />
            <span className="suffix">{plan.perUse === undefined ? '' : plan.measureUnit}</span>
          </span>
        </label>
        {rateInvalid && <p className="error span">Норма — положительное число, обычно в граммах.</p>}
        {packInvalid && <p className="error span">Содержимое одной единицы — положительное число.</p>}
        {appsInvalid && <p className="error span">Кратность — целое число раз за сезон, не меньше 1.</p>}
        {plan.warnings.map((warning) => (
          <p key={warning} className="hint span">
            {warning}
          </p>
        ))}
        <p className="hint span">
          Общая норма и кратность подставляются в новые связки с группами. Для каждой культуры их можно изменить отдельно. Для оборудования (масло, бойлер) норму на 1 раз задают в карточке работы плана.
        </p>
      </div>
      {consumable ? (
        <CareLinks
          consumableId={consumable.id}
          returnPath={`/consumables?id=${consumable.id}`}
          draftConsumable={{
            unit: materialUnit,
            ratePerM2: parseQuantity(rate),
            rateUnit: parseQuantity(rate) ? rateUnit.trim() || 'г' : undefined,
            applications: appsParsed && appsParsed > 0 ? appsParsed : undefined,
            packQuantity: parseQuantity(pack),
            packUnit: separate && parseQuantity(pack) ? substance : undefined,
          }}
        />
      ) : (
        <p className="hint">Сохраните материал, затем свяжите его с группой растений и видом работ — так посчитается количество удобрения.</p>
      )}
      {objects.length > 0 && (
        <section className="material-objects">
          <h3 className="block-title">На каких объектах используется</h3>
          <p className="hint">Справочная отметка (газон, косилка, бойлер). Норму удобрений считают по группам растений выше; для оборудования количество на 1 раз задают в плане работ.</p>
          <fieldset className="chips">
            <legend className="visually-hidden">Объекты</legend>
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
        </section>
      )}
      <label className="field">
        Примечание
        <GrowingTextarea aria-label="Примечание" rows={2} value={note} onChange={setNote} />
      </label>
      <div className="actions">
        <ActionButton disabled={!name.trim() || nameTaken || rateInvalid || packInvalid || appsInvalid || link === null} onRun={() => save()}>
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
        <ConsumableForm key={editing.id ?? 'new'} consumable={consumable} consumables={consumables} objects={[...objects].sort(byName)} onClose={close} />
      </Screen>
    )
  }

  const objectNames = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const active = consumables.filter((item) => item.active && includesAllWords(query, `${item.name} ${item.kind ?? ''} ${item.place ?? ''} ${item.description ?? ''}`)).sort(byName)
  const archived = consumables.filter((item) => !item.active).sort(byName)
  const placeGroups = groupByPlace(active)
  const showPlaces = placeGroups.some((group) => group.place)

  return (
    <Screen
      title="Расходные материалы"
      help="consumables"
      back="/more"
      tab="/more"
      add={{ label: 'Добавить материал', onClick: () => setEditing({}) }}
      actions={<SearchButton query={query} label="Поиск по материалам" placeholder="Например: уксус" onFind={setQuery} />}
    >
      <SearchQuery query={query} onClear={() => setQuery('')} />
      <p className="hint">
        Удобрения, средства защиты, семена, мульча. Здесь — само вещество: единица, фасовка и норма на м². Сколько внести за сезон считается в работе плана, где материал выбран.
        Для нового материала программа предложит полку, где уже лежат похожие.
      </p>
      {active.length === 0 && <EmptyState>Материалов пока нет. Добавьте их здесь или прямо в записи работы в дневнике.</EmptyState>}
      {placeGroups.map((group) => (
        <section key={group.place || 'none'}>
          {showPlaces && <h2 className="section-title">{group.place || 'Место не указано'}</h2>}
          <ul className="list">
            {group.items.map((item) => {
              const used = usage.get(item.id) ?? 0
              const rateLabel = item.ratePerM2
                ? `норма ${quantityText(item.ratePerM2, item.rateUnit || 'г')}/м²`
                : `единица: ${item.unit}`
              return (
                <li key={item.id}>
                  <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                    <strong>{item.name}</strong>
                    <span className="muted">
                      {rateLabel}
                      {` · израсходовано в ${year}: ${quantityText(used, item.unit)}`}
                    </span>
                    {item.objectIds.length > 0 && <span className="small">Отмечен для: {objectNames(item.objectIds)}</span>}
                    {item.description && <span className="small">{item.description}</span>}
                    {item.note && <span className="small">{item.note}</span>}
                    {item.url && <span className="small muted">Источник: {urlHost(item.url)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {archived.length > 0 && (
        <>
          <h2 className="section-title">Архив</h2>
          <ul className="list">
            {archived.map((item) => (
              <li key={item.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ id: item.id })}>
                  <strong>{item.name}</strong>
                  <span className="muted">в архиве, расход в дневнике сохранён{item.place ? ` · ${item.place}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  )
}
