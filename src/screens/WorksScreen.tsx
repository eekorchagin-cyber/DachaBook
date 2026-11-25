import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { localPath, navigate, useRoute } from '../app/router'
import { repo, type AppSettings } from '../app/store'
import { workTimes } from '../domain/applications'
import { parseNonNegative, parseQuantity } from '../domain/consumables'
import { todayAtSite } from '../domain/dates'
import { isObservationHint, OBSERVATION_HINTS } from '../domain/observations'
import { useRate } from '../domain/careLinks'
import { buyPackages, packagesFromStore, packagesToStore, purchasePlan, rateAreas } from '../domain/purchases'
import { GrowingTextarea } from '../ui/GrowingTextarea'
import type { ShoppingDraft } from '../domain/shopping'
import { addToShoppingList } from '../plan/shoppingActions'
import { excerptAround, includesAllWords, normalizeText } from '../domain/diaryFilter'
import { periodText, scheduleText } from '../domain/labels'
import { errorText } from '../lib/format'
import type { Consumable, DiaryEvent, DocInput, PlanPeriod, PlanWork, PlantGroup, SeasonSchedule, WorkCondition } from '../domain/types'
import { attachPlanWork, dismissPlanSuggestions, markDone, setSeason, skipOccurrence, undoMark } from '../plan/actions'
import { useWorkContext } from '../plan/context'
import { useWorkStatuses } from '../plan/useWorkStatuses'
import { dateText } from '../plan/frost'
import { isUpcoming, seasonStartYear, seasonWindow, WORK_STATES, type WorkStatus } from '../plan/status'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { PhotoFields } from '../ui/PhotoFields'
import { defaultSchedule, PeriodsEditor, scheduleProblem, SeasonEditor } from '../ui/ScheduleEditors'
import { SearchButton, SearchQuery } from '../ui/SearchDialog'
import { ActionButton } from '../ui/Section'

const GROUPS: { title: string; states: WorkStatus['state'][] }[] = [
  { title: 'Нужно уточнить', states: ['check'] },
  { title: 'Сейчас', states: ['overdue', 'ready'] },
  { title: 'Ждёт условий', states: ['waiting'] },
  { title: 'Скоро и позже', states: ['soon', 'postponed', 'planned'] },
  { title: 'Выполнено в этом году', states: ['done'] },
  { title: 'Пропущено в этом году', states: ['skipped'] },
]

const conditionText = (condition?: WorkCondition) =>
  !condition
    ? ''
    : condition.type === 'label' || condition.type === 'observation'
      ? condition.text
      : condition.type === 'beforeAutumnFrost'
        ? `за ${condition.leadDays} дн. до первых осенних заморозков`
        : `после весенних заморозков${condition.weekday === 6 ? ', в субботу' : ''}`

interface PlanSuggestion {
  key: string
  title: string
  count: number
  lastDate: string
  eventIds: string[]
  workKind?: string
  objectIds: string[]
}

/** Работы дневника этого года, которых ещё нет в плане. Одинаковый текст собирается в одно предложение. */
function planSuggestions(events: DiaryEvent[], year: string): PlanSuggestion[] {
  const groups = new Map<string, PlanSuggestion>()
  for (const event of events) {
    if (event.deletedAt || event.type !== 'work' || event.planWorkId || event.planSuggestionDismissed || !event.date.startsWith(year)) continue
    const sentence = event.comment.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] ?? ''
    const title = sentence.length <= 100 ? sentence : `${sentence.slice(0, 97)}…`
    if (!title) continue
    const key = normalizeText(title)
    const current = groups.get(key)
    if (!current) {
      groups.set(key, { key, title, count: 1, lastDate: event.date, eventIds: [event.id], workKind: event.workKind, objectIds: event.objectIds })
      continue
    }
    current.count += 1
    current.eventIds.push(event.id)
    if (event.date >= current.lastDate) {
      current.lastDate = event.date
      current.title = title
      current.workKind = event.workKind ?? current.workKind
      current.objectIds = event.objectIds.length ? event.objectIds : current.objectIds
    }
  }
  return [...groups.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.title.localeCompare(b.title, 'ru')).slice(0, 20)
}

function whenText(work: PlanWork): string {
  if (work.recurrence === 'season' && work.seasonSchedule) return scheduleText(work.seasonSchedule)
  if (work.recurrence === 'once') return ['один раз', periodText(work.periods)].filter(Boolean).join(', ')
  return periodText(work.periods)
}

/** Прошлые годы по дневнику: самая поздняя запись каждого года. */
function historyText(dates: string[], year: string): string {
  const byYear = new Map<string, string>()
  for (const date of dates) if (date.slice(0, 4) < year && !byYear.has(date.slice(0, 4))) byYear.set(date.slice(0, 4), date)
  return [...byYear.entries()]
    .slice(0, 6)
    .map(([y, date]) => `${y} — ${dateText(date)}`)
    .join('; ')
}

function WorkItem({
  work,
  history,
  status,
  objectNames,
  groupNames,
  noteSnippet,
  today,
  onEdit,
}: {
  work: PlanWork
  history: string[]
  status: WorkStatus
  objectNames: string
  groupNames?: string
  noteSnippet?: string
  today: string
  onEdit: () => void
}) {
  const currentYear = work.recurrence === 'season' && work.seasonSchedule ? String(seasonStartYear(work.seasonSchedule, today)) : today.slice(0, 4)
  const [postpone, setPostpone] = useState<string | null>(null)
  const past = historyText(history, currentYear)
  const repeating = work.recurrence === 'season'
  const window = work.seasonSchedule ? seasonWindow(work.seasonSchedule, Number(currentYear)) : null
  const inSeason = (date: string) => (window ? date >= window.start && date <= window.end : date.startsWith(currentYear))
  const latestSkip = (work.skippedDates ?? []).filter(inSeason).sort().at(-1)
  const latestDone = (work.doneDates ?? []).filter(inSeason).sort().at(-1)
  const canUndo = !!work.seasons[currentYear] || !!latestSkip || !!latestDone
  const open = status.state !== 'done' && status.state !== 'skipped' && !(work.condition && status.state === 'planned')
  const diaryHref = `/diary/new?plan=${work.id}${status.date && status.date > today ? `&date=${status.date}` : ''}`
  const undoLabel =
    status.state === 'skipped'
      ? 'Вернуть в этот год'
      : latestSkip && (!latestDone || latestSkip >= latestDone)
        ? 'Отменить пропуск'
        : repeating
          ? 'Отменить последнее «сделано»'
          : 'Снова показать как несделанную'
  return (
    <li className={`work-item work-${status.state}${status.urgent ? ' urgent' : ''}`}>
      <button type="button" className="work-title" onClick={onEdit}>
        <strong>{work.title}</strong>
      </button>
      <p className="small">
        <span className={`work-state state-${status.state}`}>{WORK_STATES[status.state]}</span>
        {status.message && ` — ${status.message}`}
      </p>
      <p className="small muted">
        {[whenText(work), conditionText(work.condition), objectNames, groupNames ? `растения: ${groupNames}` : '', work.workKind].filter(Boolean).join(' · ')}
      </p>
      {noteSnippet && <p className="small muted">В примечании: {noteSnippet}</p>}
      {past && <p className="small muted">По дневнику в прошлые годы: {past}</p>}
      {postpone !== null ? (
        <div className="actions">
          <input type="date" value={postpone} onChange={(event) => setPostpone(event.target.value)} aria-label="Новая дата" />
          <ActionButton
            disabled={!postpone}
            onRun={async () => {
              await setSeason(work.id, work.seasonSchedule ? String(seasonStartYear(work.seasonSchedule, postpone!)) : postpone!.slice(0, 4), { status: 'postponed', date: postpone! })
              setPostpone(null)
            }}
          >
            Перенести
          </ActionButton>
          <button type="button" className="button secondary" onClick={() => setPostpone(null)}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="actions">
          {open &&
            (repeating ? (
              <>
                <button type="button" className="button small" onClick={() => navigate(diaryHref)}>
                  Сделано
                </button>
                {(status.state === 'ready' || status.state === 'overdue') && (
                  <ActionButton secondary onRun={() => markDone(work.id, today)}>
                    Без записи в дневник
                  </ActionButton>
                )}
                <ActionButton secondary onRun={() => skipOccurrence(work.id, status.date ?? today)}>
                  Пропустить в этот раз
                </ActionButton>
              </>
            ) : (
              <>
                <button type="button" className="button small" onClick={() => navigate(diaryHref)}>
                  Выполнено
                </button>
                <button type="button" className="button secondary small" onClick={() => setPostpone(status.date && status.date > today ? status.date : '')}>
                  Перенести
                </button>
                <ActionButton
                  secondary
                  onRun={async () => {
                    if (
                      !confirm(
                        'Пропустить до следующего года? Работа останется в плане, в списке дел её не будет. Если нажали по ошибке — откройте блок «Пропущено в этом году» и нажмите «Вернуть в этот год».',
                      )
                    )
                      return
                    await setSeason(work.id, currentYear, { status: 'skipped' })
                  }}
                >
                  Пропустить в этом году
                </ActionButton>
              </>
            ))}
          {canUndo && (
            <ActionButton secondary onRun={() => undoMark(work.id, currentYear)}>
              {undoLabel}
            </ActionButton>
          )}
          <button type="button" className="button secondary small" onClick={onEdit}>
            Изменить
          </button>
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm('Убрать работу из плана? Она останется в архиве вместе с историей, её можно вернуть.')) return
              const fresh = await db.planWorks.get(work.id)
              if (!fresh) return
              await repo.update('planWorks', fresh.id, { active: false }, fresh.revision)
            }}
          >
            Убрать из плана
          </ActionButton>
        </div>
      )}
    </li>
  )
}

const num = (value: number | undefined) => (value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }))

/** Число в поле запаса: без разделителя тысяч, чтобы его можно было прочитать обратно. */
const stockText = (value: number | undefined) =>
  value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3, useGrouping: false })

function WorkMaterials({
  workId,
  consumableIds,
  stocks,
  times,
  areas,
  areaKind,
  groups,
  workKind,
  onAdd,
  onStock,
  onSave,
  onRemove,
  onEdit,
  rates,
  rateUnits,
  units,
  onRate,
  onRateUnit,
}: {
  workId?: string
  consumableIds: string[]
  stocks: Record<string, string>
  times: number
  areas: { name: string; areaM2?: number }[]
  areaKind: 'objects' | 'groups'
  groups: { id: string; name: string; areaM2?: number }[]
  workKind: string
  onAdd: (id: string) => Promise<void>
  onStock: (id: string, value: string) => void
  onSave: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onEdit: (id: string) => Promise<void>
  rates: Record<string, string>
  rateUnits: Record<string, string>
  units: string[]
  onRate: (id: string, value: string) => void
  onRateUnit: (id: string, value: string) => void
}) {
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const selected = consumableIds
    .map((id) => consumables.find((item) => item.id === id))
    .filter((item): item is Consumable => !!item)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const available = consumables.filter((item) => item.active && !consumableIds.includes(item.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const drafts: ShoppingDraft[] = selected.flatMap((item) => {
    const { buy } = materialBuy(item, stocks[item.id] ?? '', times, areas, areaKind, groups, workKind, rates[item.id] ?? '', rateUnits[item.id] || item.unit)
    if (!(buy && buy > 0)) return []
    return [{ consumableId: item.id, name: item.name, quantity: buy, unit: 'уп.', workId }]
  })
  return (
    <fieldset className="periods">
      <legend>Материалы</legend>
      <p className="hint">
        Для групп растений количество берётся из нормы связки (можно поправить здесь). Для оборудования без площади — укажите расход на 1 раз вручную по инструкции на объект.
      </p>
      {selected.length === 0 && consumables.length > 0 && <p className="hint">К этой работе материалы не выбраны.</p>}
      {selected.map((item) => (
        <MaterialNeed
          key={item.id}
          item={item}
          stock={stocks[item.id] ?? ''}
          times={times}
          areas={areas}
          areaKind={areaKind}
          groups={groups}
          workKind={workKind}
          onStock={(value) => onStock(item.id, value)}
          onSave={() => onSave(item.id)}
          onRemove={() => onRemove(item.id)}
          onEdit={() => onEdit(item.id)}
          rate={rates[item.id] ?? ''}
          rateUnit={rateUnits[item.id] || item.unit}
          units={units}
          onRate={(value) => onRate(item.id, value)}
          onRateUnit={(value) => onRateUnit(item.id, value)}
        />
      ))}
      {drafts.length > 0 && (
        <div className="actions">
          <ActionButton
            onRun={async () => {
              const result = await addToShoppingList(drafts)
              alert(
                result.added + result.updated > 0
                  ? `В «Купить»: ${[result.added ? `добавлено ${result.added}` : '', result.updated ? `обновлено ${result.updated}` : ''].filter(Boolean).join(', ')}.`
                  : 'Эти покупки уже есть в «Купить».',
              )
            }}
          >
            В «Купить»
          </ActionButton>
          <a className="button secondary" href="#/shopping">
            Открыть список
          </a>
        </div>
      )}
      {available.length > 0 && (
        <label className="field">
          Добавить материал
          <select
            aria-label="Добавить материал"
            value=""
            onChange={(event) => {
              const id = event.target.value
              if (id) void onAdd(id)
            }}
          >
            <option value="">Выберите из справочника</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {consumables.length === 0 && <p className="hint">В справочнике пока нет материалов.</p>}
    </fieldset>
  )
}

/** Расчёт потребности материала в работе: у групп — норма связки, у оборудования — ручное «на 1 раз». */
function workMaterialPlan(
  item: Consumable,
  times: number,
  areas: { name: string; areaM2?: number }[],
  areaKind: 'objects' | 'groups',
  groups: { id: string; name: string; areaM2?: number }[],
  workKind: string,
  rate: string,
  _rateUnit: string,
) {
  const manualQty = parseQuantity(rate)
  if (areaKind === 'groups' && groups.length > 0 && !manualQty) {
    let perUse = 0
    let need = 0
    let measureUnit = item.unit
    const formulas: string[] = []
    const warnings: string[] = []
    let any = false
    for (const group of groups) {
      const use =
        item.plantUses?.find((entry) => entry.plantGroupId === group.id && entry.workKind === workKind) ??
        item.plantUses?.find((entry) => entry.plantGroupId === group.id)
      const { ratePerM2, rateUnit: useUnit } = useRate(use ?? { plantGroupId: group.id, workKind }, item)
      const apps = use?.applications && use.applications > 0 ? use.applications : times
      if (!ratePerM2) {
        warnings.push(`Для группы «${group.name}» нет нормы на 1 м².`)
        continue
      }
      const plan = purchasePlan({
        unit: item.unit,
        ratePerM2,
        rateUnit: useUnit,
        applications: apps,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        areas: [{ name: group.name, areaM2: group.areaM2 }],
        areaKind: 'groups',
        usedThisYear: 0,
        pastUsage: [],
      })
      if (plan.perUse !== undefined) {
        any = true
        perUse += plan.perUse
        measureUnit = plan.measureUnit || measureUnit
      }
      if (plan.need !== undefined) need += plan.need
      if (plan.formula) formulas.push(plan.formula)
      warnings.push(...plan.warnings)
    }
    if (!any) {
      return purchasePlan({
        unit: item.unit,
        ratePerM2: item.ratePerM2,
        rateUnit: item.rateUnit,
        applications: times,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        areas,
        areaKind,
        usedThisYear: 0,
        pastUsage: [],
      })
    }
    return {
      source: 'rate' as const,
      measureUnit,
      perUse: Math.round(perUse * 1000) / 1000,
      need: need > 0 ? Math.round(need * 1000) / 1000 : undefined,
      formula: formulas.join('; ') || undefined,
      used: 0,
      stock: undefined,
      unitsNeed: item.packQuantity && need > 0 ? Math.round((need / item.packQuantity) * 1000) / 1000 : undefined,
      toBuy: undefined,
      packs: undefined,
      warnings,
    }
  }
  return purchasePlan({
    unit: item.unit,
    ratePerM2: areaKind === 'groups' && !manualQty ? item.ratePerM2 : undefined,
    rateUnit: item.rateUnit,
    applications: times,
    seasonQuantity: manualQty !== undefined ? manualQty * Math.max(1, times || 1) : undefined,
    packQuantity: item.packQuantity,
    packUnit: item.packUnit,
    areas,
    areaKind,
    usedThisYear: 0,
    pastUsage: [],
  })
}

function materialBuy(
  item: Consumable,
  stock: string,
  times: number,
  areas: { name: string; areaM2?: number }[],
  areaKind: 'objects' | 'groups',
  groups: { id: string; name: string; areaM2?: number }[],
  workKind: string,
  rate: string,
  rateUnit: string,
): { packs?: number; buy?: number; planNeed?: number; measureUnit: string } {
  const plan = workMaterialPlan(item, times, areas, areaKind, groups, workKind, rate, rateUnit)
  const packs = item.packQuantity ? plan.unitsNeed : undefined
  return { packs, buy: buyPackages(packs, parseNonNegative(stock)), planNeed: plan.need, measureUnit: plan.measureUnit || item.unit }
}

function MaterialNeed({
  item,
  stock,
  times,
  areas,
  areaKind,
  groups,
  workKind,
  onStock,
  onSave,
  onRemove,
  onEdit,
  rate,
  rateUnit,
  units,
  onRate,
  onRateUnit,
}: {
  item: Consumable
  stock: string
  times: number
  areas: { name: string; areaM2?: number }[]
  areaKind: 'objects' | 'groups'
  groups: { id: string; name: string; areaM2?: number }[]
  workKind: string
  onStock: (value: string) => void
  onSave: () => Promise<void>
  onRemove: () => Promise<void>
  onEdit: () => Promise<void>
  rate: string
  rateUnit: string
  units: string[]
  onRate: (value: string) => void
  onRateUnit: (value: string) => void
}) {
  const stockInvalid = !!stock.trim() && parseNonNegative(stock) === undefined
  const plan = workMaterialPlan(item, times, areas, areaKind, groups, workKind, rate, rateUnit)
  const packs = item.packQuantity ? plan.unitsNeed : undefined
  const buy = buyPackages(packs, parseNonNegative(stock))
  const suggested = plan.perUse !== undefined && !rate.trim() ? num(plan.perUse) : rate
  const displayUnit = rate.trim() ? rateUnit : plan.measureUnit || rateUnit
  const perUseLabel = suggested.trim() ? `${suggested} ${displayUnit}` : ''
  const equipment = areaKind === 'objects' || groups.length === 0
  return (
    <div className="material-block">
      <div className="calc-grid">
        <p className="span">
          <button type="button" className="source-link button-link" onClick={() => void onEdit()}>
            {item.name}
          </button>
          {perUseLabel ? `, ${perUseLabel} на 1 раз` : ''}
        </p>
        <label className="field span">
          На 1 раз для этой работы
          <span className="measure-line">
            <input
              aria-label={`На 1 раз ${item.name}`}
              inputMode="decimal"
              placeholder={plan.perUse !== undefined ? num(plan.perUse) : 'Например: 400'}
              value={rate}
              onChange={(event) => onRate(event.target.value)}
            />
            <select aria-label={`Единица на 1 раз ${item.name}`} value={rateUnit} onChange={(event) => onRateUnit(event.target.value)}>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </span>
        </label>
        <p className="hint span">
          {equipment
            ? 'Для оборудования (масло, бойлер) укажите расход на 1 раз по инструкции на объект. Пустое поле — без расчёта по м².'
            : `Подсказка из нормы×площадь: ${plan.perUse !== undefined ? `${num(plan.perUse)} ${plan.measureUnit}` : '—'}. Можно поправить для этой работы.`}
        </p>
        <label className="field span">
          Требуется на сезон
          <span className="result-line">
            <input aria-label={`Требуется на сезон ${item.name}`} readOnly value={num(plan.need)} placeholder="—" />
            <span className="suffix">{plan.need === undefined ? '' : plan.measureUnit}</span>
            {packs !== undefined && (
              <>
                <input aria-label={`Требуется упаковок ${item.name}`} readOnly value={num(packs)} />
                <span className="suffix">уп.</span>
              </>
            )}
          </span>
        </label>
        {times > 0 && plan.need !== undefined && (
          <p className="hint span">
            Учёт кратности: {times} раз по срокам работы
            {plan.formula ? ` · ${plan.formula}` : ''}
          </p>
        )}
        <label className="field">
          Запас сейчас
          <span className="result-line">
            <input aria-label={`Запас ${item.name}`} inputMode="decimal" placeholder="—" value={stock} onChange={(event) => onStock(event.target.value)} />
            <span className="suffix">уп.</span>
          </span>
        </label>
        <label className="field">
          Купить
          <span className="result-line">
            <input aria-label={`Купить ${item.name}`} readOnly value={num(buy)} placeholder="—" />
            <span className="suffix">уп.</span>
          </span>
        </label>
        {!item.packQuantity && <p className="hint span">Укажите в карточке материала, сколько в одной упаковке, — иначе запас и покупка в упаковках не считаются.</p>}
        {plan.warnings.map((warning) => (
          <p key={warning} className="hint span">
            {warning}
          </p>
        ))}
        {stockInvalid && <p className="error span">Запас — ноль или положительное число упаковок.</p>}
      </div>
      <div className="actions">
        <ActionButton disabled={stockInvalid} onRun={onSave}>
          Сохранить
        </ActionButton>
        <button type="button" className="button secondary" onClick={() => void onEdit()}>
          Изменить
        </button>
        <ActionButton secondary onRun={onRemove}>
          Удалить
        </ActionButton>
      </div>
    </div>
  )
}

function WorkForm({
  work,
  suggestion,
  settings,
  objects,
  plantGroups,
  presetGroupId,
  presetObjectId,
  onClose,
}: {
  work?: PlanWork
  suggestion?: PlanSuggestion
  settings: AppSettings
  objects: { id: string; name: string; areaM2?: number }[]
  plantGroups: PlantGroup[]
  presetGroupId?: string
  presetObjectId?: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(work?.title ?? suggestion?.title ?? '')
  const [workKind, setWorkKind] = useState(work?.workKind ?? suggestion?.workKind ?? '')
  const [objectIds, setObjectIds] = useState(work?.objectIds ?? suggestion?.objectIds ?? (presetObjectId ? [presetObjectId] : []))
  const [plantGroupIds, setPlantGroupIds] = useState<string[]>(work?.plantGroupIds ?? (presetGroupId ? [presetGroupId] : []))
  const [recurrence, setRecurrence] = useState<PlanWork['recurrence']>(work?.recurrence ?? 'yearly')
  const [periods, setPeriods] = useState<PlanPeriod[]>(work?.periods ?? (suggestion ? [{ month: Number(suggestion.lastDate.slice(5, 7)) }] : []))
  const [schedule, setSchedule] = useState<SeasonSchedule>(work?.seasonSchedule ?? defaultSchedule(suggestion?.lastDate))
  const [rhythm, setRhythm] = useState<'weeks' | 'days'>(work?.seasonSchedule?.weekdays?.length ? 'days' : 'weeks')
  const [conditionType, setConditionType] = useState<'' | WorkCondition['type']>(work?.condition?.type ?? '')
  const [conditionLabel, setConditionLabel] = useState(
    work?.condition?.type === 'label' || work?.condition?.type === 'observation' ? work.condition.text : '',
  )
  const [leadDays, setLeadDays] = useState(String(work?.condition?.type === 'beforeAutumnFrost' ? work.condition.leadDays : 7))
  const [note, setNote] = useState(work?.note ?? '')
  const [consumableIds, setConsumableIds] = useState<string[]>(work?.consumableIds ?? [])
  const [rateText, setRateText] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(work?.consumableRates ?? {}).map(([id, rate]) => [id, String(rate.quantity)])),
  )
  const [rateUnits, setRateUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(work?.consumableRates ?? {}).map(([id, rate]) => [id, rate.unit ?? ''])),
  )
  const [photoIds, setPhotoIds] = useState(work?.photoIds ?? [])
  const [fileNotes, setFileNotes] = useState(work?.fileNotes ?? {})
  const [workId, setWorkId] = useState(work?.id)
  const [revision, setRevision] = useState(work?.revision)
  const [stocks, setStocks] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [suggestionLinked, setSuggestionLinked] = useState(!suggestion || !!work)
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  const toggleGroup = (id: string) => setPlantGroupIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  const today = todayAtSite().date
  const previewSchedule: SeasonSchedule | undefined =
    recurrence === 'season'
      ? {
          fromMonth: schedule.fromMonth,
          fromDay: schedule.fromDay,
          toMonth: schedule.toMonth,
          toDay: schedule.toDay,
          ...(rhythm === 'days' ? { weekdays: [...(schedule.weekdays ?? [])].sort((a, b) => a - b) } : { everyWeeks: schedule.everyWeeks ?? 2 }),
          timeFrom: schedule.timeFrom || undefined,
          timeTo: schedule.timeTo || undefined,
        }
      : undefined
  const times = workTimes({ recurrence, periods: recurrence === 'season' ? [] : periods, seasonSchedule: previewSchedule }, today)
  const rated = rateAreas(
    plantGroups.filter((group) => plantGroupIds.includes(group.id)).map((group) => ({ name: group.name, areaM2: group.areaM2 })),
    objects.filter((object) => objectIds.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 })),
  )
  const stockOf = (id: string) => {
    const typed = stocks[id]
    if (typed !== undefined) return typed
    const item = consumables.find((entry) => entry.id === id)
    return item ? stockText(packagesFromStore(item.stockQuantity, item)) : ''
  }

  const buildInput = (ids: string[], active: boolean): DocInput<PlanWork> | undefined => {
    const problem = recurrence === 'season' ? scheduleProblem(schedule, rhythm) : ''
    if (problem) {
      setError(problem)
      return undefined
    }
    if (!title.trim()) {
      setError('Сначала укажите, что сделать.')
      return undefined
    }
    setError('')
    const consumableRates = Object.fromEntries(
      ids.flatMap((id) => {
        const manual = parseQuantity(rateText[id] ?? '')
        if (manual) return [[id, { quantity: manual, unit: rateUnits[id] || undefined }]]
        const item = consumables.find((entry) => entry.id === id)
        if (!item?.ratePerM2) return []
        const auto = purchasePlan({
          unit: item.unit,
          ratePerM2: item.ratePerM2,
          rateUnit: item.rateUnit,
          applications: 1,
          packQuantity: item.packQuantity,
          packUnit: item.packUnit,
          areas: rated.areas,
          areaKind: rated.areaKind,
          usedThisYear: 0,
          pastUsage: [],
        })
        if (auto.perUse === undefined) return []
        return [[id, { quantity: auto.perUse, unit: auto.measureUnit || item.unit }]]
      }),
    )
    const condition: WorkCondition | undefined =
      recurrence === 'yearly' && conditionType === 'beforeAutumnFrost'
        ? { type: 'beforeAutumnFrost', leadDays: Math.max(1, Number(leadDays) || 7) }
        : recurrence === 'yearly' && conditionType === 'afterSpringFrost'
          ? { type: 'afterSpringFrost', weekday: 6, calmDays: 3 }
          : recurrence === 'yearly' && conditionType === 'observation' && conditionLabel
            ? { type: 'observation', text: conditionLabel }
            : recurrence === 'yearly' && conditionType === 'label' && conditionLabel
              ? { type: 'label', text: conditionLabel }
              : undefined
    const seasonSchedule: SeasonSchedule | undefined =
      recurrence === 'season'
        ? {
            fromMonth: schedule.fromMonth,
            fromDay: schedule.fromDay,
            toMonth: schedule.toMonth,
            toDay: schedule.toDay,
            ...(rhythm === 'days' ? { weekdays: [...(schedule.weekdays ?? [])].sort((a, b) => a - b) } : { everyWeeks: schedule.everyWeeks ?? 2 }),
            timeFrom: schedule.timeFrom || undefined,
            timeTo: schedule.timeTo || undefined,
          }
        : work?.seasonSchedule
    return {
      title: title.trim(),
      workKind: workKind || undefined,
      objectIds,
      plantGroupIds,
      note: note.trim() || undefined,
      recurrence,
      periods: recurrence === 'season' ? [] : periods,
      condition,
      seasonSchedule,
      doneDates: work?.doneDates,
      skippedDates: work?.skippedDates,
      historyWords: work?.historyWords,
      sourceDraftId: work?.sourceDraftId,
      consumableIds: ids,
      consumableRates,
      photoIds,
      fileNotes,
      seasons: work?.seasons ?? {},
      active,
    }
  }

  /** Записывает работу и список её материалов. Запас материалов не трогает. */
  const writeWork = async (ids: string[], active = work?.active ?? true): Promise<PlanWork | undefined> => {
    const input = buildInput(ids, active)
    if (!input) return undefined
    const creating = !workId || !revision
    const saved = creating ? await repo.create('planWorks', input) : await repo.update('planWorks', workId, input, revision)
    setWorkId(saved.id)
    setRevision(saved.revision)
    setConsumableIds(ids)
    if (suggestion && !suggestionLinked) {
      await attachPlanWork(suggestion.eventIds, saved.id)
      setSuggestionLinked(true)
    }
    return saved
  }

  const addMaterial = async (id: string) => {
    if (consumableIds.includes(id)) return
    try {
      await writeWork([...consumableIds, id])
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const removeMaterial = async (id: string) => {
    if (!confirm('Убрать материал из этой работы? В справочнике он останется.')) return
    const saved = await writeWork(consumableIds.filter((item) => item !== id))
    if (!saved) return
    setStocks((current) => {
      if (current[id] === undefined) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const saveStock = async (id: string) => {
    const current = await db.consumables.get(id)
    if (!current || current.deletedAt) return
    const shown = stockOf(id)
    const packs = parseNonNegative(shown)
    if (shown.trim() && packs === undefined) return
    const stockQuantity = packagesToStore(packs, current)
    if (stockQuantity !== current.stockQuantity && !(stockQuantity === undefined && current.stockQuantity === undefined)) {
      await repo.update('consumables', id, { stockQuantity }, current.revision)
    }
    setStocks((draft) => ({ ...draft, [id]: stockText(packagesFromStore(stockQuantity, current)) }))
  }

  const openMaterial = async (id: string) => {
    const saved = await writeWork(consumableIds)
    if (!saved) return
    navigate(`/consumables?id=${id}&work=${saved.id}`)
  }

  const save = async (active = work?.active ?? true) => {
    const saved = await writeWork(consumableIds, active)
    if (saved) onClose()
  }

  return (
    <section className="card">
      <h2>{work ? 'Изменить работу' : 'Новая работа'}</h2>
      <label className="field">
        Что сделать
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        Вид работы
        <select value={workKind} onChange={(event) => setWorkKind(event.target.value)}>
          <option value="">Не указан</option>
          {settings.workKinds.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Как повторять
        <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as PlanWork['recurrence'])}>
          <option value="yearly">Каждый год — укажите сроки ниже</option>
          <option value="season">В сезоне — окно дат и ритм ниже</option>
          <option value="once">Один раз — укажите срок ниже</option>
        </select>
      </label>
      {objects.length > 0 && (
        <fieldset className="chips">
          <legend>Объекты</legend>
          {objects.map((object) => (
            <label key={object.id} className={objectIds.includes(object.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={objectIds.includes(object.id)} onChange={() => toggle(object.id)} />
              {object.name}
            </label>
          ))}
        </fieldset>
      )}
      {plantGroups.length > 0 && (
        <fieldset className="chips">
          <legend>Группы растений</legend>
          {plantGroups.map((group) => (
            <label key={group.id} className={plantGroupIds.includes(group.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={plantGroupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} />
              {group.name}
              {group.areaM2 !== undefined ? ` · ${group.areaM2} м²` : ''}
            </label>
          ))}
        </fieldset>
      )}
      {plantGroups.length > 0 && (
        <p className="hint">
          Норму удобрений считают по площади группы растений (трава газонная), а не по объекту участка (газон): на объекте могут быть и другие культуры. Если группы выбраны, площадь объектов в расчёт не входит — двойного учёта нет. Сколько нужно группе, видно в её карточке и в связке материала с видом работ.
        </p>
      )}
      {recurrence === 'season' ? (
        <SeasonEditor schedule={schedule} rhythm={rhythm} onSchedule={setSchedule} onRhythm={setRhythm} />
      ) : (
        <PeriodsEditor periods={periods} onChange={setPeriods} />
      )}
      {recurrence === 'yearly' && periods.length === 0 && !conditionType && (
        <p className="hint">Без месяца или условия работа попадёт в план в блок «Нужно уточнить» — задайте срок, чтобы она появилась среди дел на дату.</p>
      )}
      <WorkMaterials
        workId={workId}
        consumableIds={consumableIds}
        stocks={Object.fromEntries(consumableIds.map((id) => [id, stockOf(id)]))}
        times={times}
        areas={rated.areas}
        areaKind={rated.areaKind}
        groups={plantGroups.filter((group) => plantGroupIds.includes(group.id)).map((group) => ({ id: group.id, name: group.name, areaM2: group.areaM2 }))}
        workKind={workKind}
        onAdd={addMaterial}
        onStock={(id, value) => setStocks((current) => ({ ...current, [id]: value }))}
        onSave={saveStock}
        onRemove={removeMaterial}
        onEdit={openMaterial}
        rates={rateText}
        rateUnits={rateUnits}
        units={settings.consumableUnits}
        onRate={(id, value) => setRateText((current) => ({ ...current, [id]: value }))}
        onRateUnit={(id, value) => setRateUnits((current) => ({ ...current, [id]: value }))}
      />
      {recurrence === 'yearly' && (
      <label className="field">
        Условие
        <select
          value={conditionType === 'observation' || conditionType === 'label' ? `${conditionType}:${conditionLabel}` : conditionType}
          onChange={(event) => {
            const value = event.target.value
            if (value.startsWith('observation:')) {
              setConditionType('observation')
              setConditionLabel(value.slice('observation:'.length))
              return
            }
            if (value.startsWith('label:')) {
              setConditionType('label')
              setConditionLabel(value.slice('label:'.length))
              return
            }
            setConditionType(value as typeof conditionType)
            setConditionLabel('')
          }}
        >
          <option value="">Без условия — по срокам</option>
          <option value="beforeAutumnFrost">До первых осенних заморозков</option>
          <option value="afterSpringFrost">После весенних заморозков, в ближайшую субботу</option>
          {[...new Set([...OBSERVATION_HINTS, ...(conditionType === 'observation' && conditionLabel ? [conditionLabel] : [])])].map((text) => (
            <option key={`observation:${text}`} value={`observation:${text}`}>
              {text}
            </option>
          ))}
          {[...new Set([...(conditionType === 'label' && conditionLabel ? [conditionLabel] : []), ...settings.workConditions.filter((text) => !isObservationHint(text))])].map((text) => (
            <option key={`label:${text}`} value={`label:${text}`}>
              {text}
            </option>
          ))}
        </select>
      </label>
      )}
      {recurrence === 'yearly' && conditionType === 'afterSpringFrost' && (
        <p className="hint">После весенних заморозков, в ближайшую субботу.</p>
      )}
      {recurrence === 'yearly' && conditionType === 'observation' && conditionLabel && (
        <p className="hint">Работа станет готовой, когда в дневнике этого года появится наблюдение «{conditionLabel}».</p>
      )}
      {recurrence === 'yearly' && conditionType === 'label' && conditionLabel && <p className="hint">{conditionLabel}</p>}
      {recurrence === 'yearly' && conditionType === 'beforeAutumnFrost' && (
        <label className="field">
          За сколько дней до заморозков напоминать
          <input inputMode="numeric" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
        </label>
      )}
      {recurrence === 'yearly' && conditionType === 'label' && (
        <p className="hint">Это подпись из справочника условий. День работы она не назначает: отметьте выполнение, когда на участке так и произошло.</p>
      )}
      <h3 className="section-title">Фотографии</h3>
      <PhotoFields ids={photoIds} notes={fileNotes} onChange={(ids, notes) => { setPhotoIds(ids); setFileNotes(notes) }} />
      <label className="field">
        Примечание
        <GrowingTextarea aria-label="Примечание" rows={3} value={note} onChange={setNote} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton disabled={!title.trim()} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {work && (
          <ActionButton secondary onRun={() => save(!work.active)}>
            {work.active ? 'Убрать из плана' : 'Вернуть в план'}
          </ActionButton>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

function ClimateNote() {
  const { climate, climateRange, climateYears, today } = useWorkContext()
  if (!climate || !climateRange) return null
  const year = today.slice(0, 4)
  const range = (summary?: { median: string; earliest: string; latest: string }) =>
    summary ? `обычно около ${dateText(`${year}-${summary.median}`)} (с ${dateText(`${year}-${summary.earliest}`)} по ${dateText(`${year}-${summary.latest}`)})` : 'нет данных'
  return (
    <details className="card climate">
      <summary>
        <strong>Заморозки на участке за {climateRange}</strong>
      </summary>
      <p className="small">Последние весенние — {range(climate.spring)}.</p>
      <p className="small">Первые осенние — {range(climate.autumn)}.</p>
      <ul className="small muted">
        {(climateYears ?? []).map((item) => (
          <li key={item.year}>
            {item.year}: весной до {item.lastSpring ? dateText(item.lastSpring) : '—'}, осенью с {item.firstAutumn ? dateText(item.firstAutumn) : '—'}
          </li>
        ))}
      </ul>
      <p className="small muted">По архиву Open-Meteo для координат участка: заморозок — сутки, когда воздух на высоте 2 м остывал ниже 0 °C. Это модельная оценка, а не измерение на участке. Такие дни сами появляются в дневнике как наблюдения.</p>
    </details>
  )
}

export function WorksScreen({ settings }: { settings: AppSettings }) {
  const { list, works, context } = useWorkStatuses()
  const objects = useLiveQuery(() => db.objects.toArray(), []) ?? []
  const plantGroups = useLiveQuery(() => db.plantGroups.toArray(), []) ?? []
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const route = useRoute()
  const requested = route.query.get('work')
  const back = localPath(route.query.get('back'))
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id?: string; suggestion?: PlanSuggestion; groupId?: string; objectId?: string } | null>(
    requested === 'new'
      ? { groupId: route.query.get('group') ?? undefined, objectId: route.query.get('object') ?? undefined }
      : requested
        ? { id: requested }
        : null,
  )
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  const close = () => {
    setEditing(null)
    if (back) navigate(back)
    else if (requested) navigate('/works')
  }

  if (editing) {
    if (editing.id && works === undefined) {
      return (
        <Screen title="План работ" help="works" onBack={close} tab="/more">
          <p className="hint">Загрузка…</p>
        </Screen>
      )
    }
    const work = works?.find((item) => item.id === editing.id)
    if (editing.id && works && !work) {
      return (
        <Screen title="План работ" help="works" onBack={close} tab="/more">
          <p className="hint">Такой работы нет.</p>
        </Screen>
      )
    }
    const formObjects = objects.filter((object) => !object.deletedAt && (object.active || work?.objectIds.includes(object.id)))
    return (
      <Screen title="План работ" help="works" onBack={close} tab="/more">
        <WorkForm
          key={editing.id ?? editing.suggestion?.key ?? 'new'}
          work={work}
          suggestion={editing.suggestion}
          settings={settings}
          objects={formObjects}
          plantGroups={plantGroups.filter((group) => !group.deletedAt && (group.active || work?.plantGroupIds.includes(group.id))).sort((a, b) => a.name.localeCompare(b.name, 'ru'))}
          presetGroupId={editing.groupId}
          presetObjectId={editing.objectId}
          onClose={close}
        />
      </Screen>
    )
  }

  const names = (ids: string[], source: { id: string; name: string }[]) => ids.map((id) => source.find((item) => item.id === id)?.name).filter(Boolean).join(', ')
  const objectNames = (ids: string[]) => names(ids, objects)
  const groupLabel = (ids: string[]) => {
    const label = names(ids, plantGroups)
    return label ? `растения: ${label}` : ''
  }
  /** Текст, который и так виден на карточке. Примечание сюда не входит: его показываем отдельно, только если слово нашлось там. */
  const visibleText = (work: PlanWork, extra = '') =>
    [work.title, work.workKind, objectNames(work.objectIds), groupLabel(work.plantGroupIds), whenText(work), conditionText(work.condition), extra].filter(Boolean).join(' ')
  const noteOnly = (work: PlanWork, visible: string) => {
    if (!work.note || includesAllWords(query, visible) || !includesAllWords(query, `${visible} ${work.note}`)) return undefined
    return excerptAround(query, work.note)
  }
  const matchesWork = (work: PlanWork, extra = '') => includesAllWords(query, `${visibleText(work, extra)} ${work.note ?? ''}`)
  const archived = (works ?? []).filter((work) => !work.active && matchesWork(work))
  const closed = list.filter((item) => item.status.closed && matchesWork(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`))
  const allSuggestions = planSuggestions(events, context.today.slice(0, 4))
  const suggestions = allSuggestions.filter((item) => includesAllWords(query, [item.title, item.workKind].filter(Boolean).join(' ')))
  const groups = GROUPS.map((group) => ({
    ...group,
    items: list.filter((item) => !item.status.closed && group.states.includes(item.status.state) && matchesWork(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`)),
  })).filter((group) => group.items.length > 0)
  const hasWorks = (works?.length ?? 0) > 0 || allSuggestions.length > 0
  const visible = groups.length + suggestions.length + closed.length + archived.length

  return (
    <Screen
      title="План работ"
      help="works"
      back="/more/works"
      tab="/more"
      add={{ label: 'Новая работа', onClick: () => setEditing({}) }}
      actions={<SearchButton query={query} label="Поиск по плану работ" placeholder="Например: гортензии" onFind={setQuery} />}
    >
      <div className="actions plan-actions">
        <a className="button secondary" href="#/plan">
          Из черновика Evernote
        </a>
      </div>
      <SearchQuery query={query} onClear={() => setQuery('')} />
      {!settings.plotLocation && (
        <p className="hint">
          Для работ, зависящих от заморозков, нужны координаты участка: <a href="#/settings?part=plot-location">«Ещё → Участок → Координаты для погоды»</a>.
        </p>
      )}
      <ClimateNote />
      {works && !hasWorks && <EmptyState>Работ пока нет. Добавьте свою или перенесите из черновика Evernote.</EmptyState>}
      {works && hasWorks && visible === 0 && <EmptyState>Ничего не найдено. Измените запрос или сбросьте поиск.</EmptyState>}
      {groups.map((group) => (
        <section key={group.title}>
          <h2 className="section-title">{group.title}</h2>
          {group.title === 'Нужно уточнить' && (
            <p className="hint">Нет месяца, условия или расписания — откройте работу и задайте срок. Пока срока нет, она не попадает в «Сейчас», хотя уже есть в общем плане (в том числе если добавили из карточки объекта).</p>
          )}
          {group.title === 'Пропущено в этом году' && (
            <p className="hint">Если пропустили по ошибке — «Вернуть в этот год». Сама работа из плана не удаляется.</p>
          )}
          <ul className="list">
            {group.items.map((item) => (
              <WorkItem
                key={item.work.id}
                {...item}
                today={context.today}
                objectNames={objectNames(item.work.objectIds)}
                groupNames={names(item.work.plantGroupIds, plantGroups)}
                noteSnippet={noteOnly(item.work, visibleText(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`))}
                onEdit={() => setEditing({ id: item.work.id })}
              />
            ))}
          </ul>
        </section>
      ))}
      {suggestions.length > 0 && (
        <section>
          <h2 className="section-title">Предложения из дневника этого года</h2>
          <p className="hint">Это ещё не план. «В план» добавляет работу, «Удалить из предложений» только скрывает её здесь. Записи дневника остаются.</p>
          <ul className="list">
            {suggestions.map((item) => (
              <li key={item.key} className="work-item">
                <strong>{item.title}</strong>
                <p className="small muted">
                  {item.count > 1 ? `${item.count} раз в дневнике, последний ${dateText(item.lastDate)}` : dateText(item.lastDate)}
                  {item.workKind ? ` · ${item.workKind}` : ''}
                </p>
                <div className="actions">
                  <button type="button" className="button small" onClick={() => setEditing({ suggestion: item })}>
                    В план
                  </button>
                  <ActionButton
                    secondary
                    onRun={async () => {
                      if (!confirm('Удалить из предложений? Записи дневника останутся.')) return
                      await dismissPlanSuggestions(item.eventIds)
                    }}
                  >
                    Удалить из предложений
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h2 className="section-title">Больше не повторяются</h2>
          <ul className="list">
            {closed.map((item) => {
              const snippet = noteOnly(item.work, visibleText(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`))
              return (
                <li key={item.work.id}>
                  <button type="button" className="list-item" onClick={() => setEditing({ id: item.work.id })}>
                    <strong>{item.work.title}</strong>
                    <span className="muted">сделано и не повторяется</span>
                    {snippet && <span className="small">В примечании: {snippet}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {archived.length > 0 && (
        <section>
          <h2 className="section-title">Архив</h2>
          <ul className="list">
            {archived.map((work) => {
              const snippet = noteOnly(work, visibleText(work))
              return (
                <li key={work.id}>
                  <button type="button" className="list-item" onClick={() => setEditing({ id: work.id })}>
                    <strong>{work.title}</strong>
                    <span className="muted">в архиве, история сохранена</span>
                    {snippet && <span className="small">В примечании: {snippet}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </Screen>
  )
}

/** Карточка на главном экране: что делать сейчас и в ближайшие две недели, предупреждения о заморозках. */
export function UpcomingWorksCard() {
  const { list } = useWorkStatuses()
  const upcoming = list.filter((item) => !item.status.closed && isUpcoming(item.status)).slice(0, 5)
  return (
    <section className="card">
      <div className="card-header">
        <h2>Ближайшие работы</h2>
        <a className="small source-link" href="#/works">
          Весь план
        </a>
      </div>
      {upcoming.length === 0 ? (
        <p className="hint">На ближайшие две недели работ нет. План — в «Ещё → План работ».</p>
      ) : (
        <ul className="upcoming">
          {upcoming.map(({ work, status }) => (
            <li key={work.id} className={status.urgent ? 'urgent' : ''}>
              <a href="#/works">
                <strong>{work.title}</strong>
              </a>
              <span className="small">
                <span className={`work-state state-${status.state}`}>{WORK_STATES[status.state]}</span>
                {status.message && ` — ${status.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

