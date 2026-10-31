import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { navigate, useRoute } from '../app/router'
import { repo, type AppSettings } from '../app/store'
import { workTimes } from '../domain/applications'
import { parseNonNegative } from '../domain/consumables'
import { MONTH_NAMES, todayAtSite } from '../domain/dates'
import { buyPackages, packagesFromStore, packagesToStore, purchasePlan } from '../domain/purchases'
import { includesAllWords, normalizeText } from '../domain/diaryFilter'
import { periodText, scheduleText } from '../domain/labels'
import { errorText } from '../lib/format'
import type { Consumable, DiaryEvent, DocInput, PlanPeriod, PlanWork, SeasonSchedule, WorkCondition } from '../domain/types'
import { attachPlanWork, dismissPlanSuggestions, markDone, setSeason, skipOccurrence, undoMark } from '../plan/actions'
import { useWorkContext } from '../plan/context'
import { useWorkStatuses } from '../plan/useWorkStatuses'
import { dateText } from '../plan/frost'
import { isUpcoming, seasonStartYear, seasonWindow, WORK_STATES, type WorkStatus } from '../plan/status'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const GROUPS: { title: string; states: WorkStatus['state'][] }[] = [
  { title: 'Сейчас', states: ['overdue', 'ready'] },
  { title: 'Ждёт условий', states: ['waiting', 'check'] },
  { title: 'Скоро и позже', states: ['soon', 'postponed', 'planned'] },
  { title: 'Выполнено в этом году', states: ['done'] },
  { title: 'Пропущено в этом году', states: ['skipped'] },
]

const conditionText = (condition?: WorkCondition) =>
  !condition
    ? ''
    : condition.type === 'beforeAutumnFrost'
      ? `за ${condition.leadDays} дн. до первых осенних заморозков`
      : `после весенних заморозков${condition.weekday === 6 ? ', в субботу' : ''}`

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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

function defaultSchedule(date?: string): SeasonSchedule {
  const month = date ? Number(date.slice(5, 7)) : new Date().getMonth() + 1
  const day = date ? Number(date.slice(8, 10)) : new Date().getDate()
  const toMonth = Math.min(12, Math.max(month, 9))
  const toDay = toMonth === month ? Math.max(day, 28) : toMonth === 9 ? 30 : 28
  return { fromMonth: month, fromDay: day, toMonth, toDay, everyWeeks: 2 }
}

function dayExists(month: number, day: number): boolean {
  return day >= 1 && day <= 31 && new Date(Date.UTC(2024, month - 1, day)).getUTCDate() === day
}

function scheduleProblem(schedule: SeasonSchedule, rhythm: 'weeks' | 'days'): string {
  if (!dayExists(schedule.fromMonth, schedule.fromDay) || !dayExists(schedule.toMonth, schedule.toDay)) return 'В этом месяце нет такого дня.'
  if (rhythm === 'days' && !(schedule.weekdays ?? []).length) return 'Выберите хотя бы один день недели.'
  if (schedule.timeTo && !schedule.timeFrom) return 'Укажите время начала.'
  if (schedule.timeFrom && schedule.timeTo && schedule.timeFrom > schedule.timeTo) return 'Время окончания раньше начала.'
  return ''
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

function WorkItem({ work, history, status, objectNames, today, onEdit }: { work: PlanWork; history: string[]; status: WorkStatus; objectNames: string; today: string; onEdit: () => void }) {
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
        {[whenText(work), conditionText(work.condition), objectNames, work.workKind].filter(Boolean).join(' · ')}
      </p>
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

function PeriodsEditor({ periods, onChange }: { periods: PlanPeriod[]; onChange: (periods: PlanPeriod[]) => void }) {
  return (
    <fieldset className="periods">
      <legend>Сроки (месяц и неделя)</legend>
      {periods.map((period, index) => (
        <div key={index} className="period-row">
          <select aria-label="Месяц" value={period.month} onChange={(event) => onChange(periods.map((item, current) => (current === index ? { ...item, month: Number(event.target.value) } : item)))}>
            {MONTH_NAMES.map((name, month) => (
              <option key={name} value={month + 1}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Неделя"
            value={period.week ?? ''}
            onChange={(event) => onChange(periods.map((item, current) => (current === index ? { ...item, week: event.target.value ? Number(event.target.value) : undefined } : item)))}
          >
            <option value="">весь месяц</option>
            {[1, 2, 3, 4].map((week) => (
              <option key={week} value={week}>
                {week}-я неделя
              </option>
            ))}
          </select>
          <button type="button" className="icon-button" aria-label="Убрать срок" onClick={() => onChange(periods.filter((_, current) => current !== index))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="button secondary small" onClick={() => onChange([...periods, { month: new Date().getMonth() + 1 }])}>
        + Срок
      </button>
    </fieldset>
  )
}

function patchSchedule(schedule: SeasonSchedule, patch: Partial<SeasonSchedule>): SeasonSchedule {
  return { ...schedule, ...patch }
}

function SeasonEditor({ schedule, rhythm, onSchedule, onRhythm }: { schedule: SeasonSchedule; rhythm: 'weeks' | 'days'; onSchedule: (schedule: SeasonSchedule) => void; onRhythm: (rhythm: 'weeks' | 'days') => void }) {
  const toggleDay = (day: number) => {
    const days = schedule.weekdays ?? []
    onSchedule(patchSchedule(schedule, { weekdays: days.includes(day) ? days.filter((item) => item !== day) : [...days, day] }))
  }
  const bound = (key: 'from' | 'to', month: number, day: number) =>
    onSchedule(key === 'from' ? patchSchedule(schedule, { fromMonth: month, fromDay: day }) : patchSchedule(schedule, { toMonth: month, toDay: day }))
  return (
    <fieldset className="periods">
      <legend>Повтор в сезоне</legend>
      <div className="segmented">
        <button type="button" className={rhythm === 'weeks' ? 'active' : ''} onClick={() => onRhythm('weeks')}>
          Каждые N недель
        </button>
        <button type="button" className={rhythm === 'days' ? 'active' : ''} onClick={() => onRhythm('days')}>
          По дням недели
        </button>
      </div>
      {rhythm === 'weeks' ? (
        <label className="field">
          Как часто
          <select value={schedule.everyWeeks ?? 2} onChange={(event) => onSchedule(patchSchedule(schedule, { everyWeeks: Number(event.target.value) }))}>
            <option value={1}>каждую неделю</option>
            <option value={2}>раз в 2 недели</option>
            <option value={3}>раз в 3 недели</option>
            <option value={4}>раз в 4 недели</option>
          </select>
        </label>
      ) : (
        <div className="chips">
          {WEEKDAY_LABELS.map((label, index) => {
            const day = index + 1
            const active = (schedule.weekdays ?? []).includes(day)
            return (
              <button key={label} type="button" className={active ? 'chip active' : 'chip'} onClick={() => toggleDay(day)}>
                {label}
              </button>
            )
          })}
        </div>
      )}
      {(['from', 'to'] as const).map((key) => (
        <div key={key} className="period-row">
          <span className="small">{key === 'from' ? 'С' : 'По'}</span>
          <select
            aria-label={key === 'from' ? 'Месяц начала' : 'Месяц окончания'}
            value={key === 'from' ? schedule.fromMonth : schedule.toMonth}
            onChange={(event) => bound(key, Number(event.target.value), key === 'from' ? schedule.fromDay : schedule.toDay)}
          >
            {MONTH_NAMES.map((name, month) => (
              <option key={name} value={month + 1}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label={key === 'from' ? 'День начала' : 'День окончания'}
            value={key === 'from' ? schedule.fromDay : schedule.toDay}
            onChange={(event) => bound(key, key === 'from' ? schedule.fromMonth : schedule.toMonth, Number(event.target.value))}
          >
            {Array.from({ length: 31 }, (_, day) => (
              <option key={day + 1} value={day + 1}>
                {day + 1}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="period-row">
        <label className="field">
          Время с
          <input type="time" value={schedule.timeFrom ?? ''} onChange={(event) => onSchedule(patchSchedule(schedule, { timeFrom: event.target.value }))} />
        </label>
        <label className="field">
          до
          <input type="time" value={schedule.timeTo ?? ''} onChange={(event) => onSchedule(patchSchedule(schedule, { timeTo: event.target.value }))} />
        </label>
      </div>
      <p className="hint">
        Окно повторяется каждый год. Если окончание раньше начала (уборка снега с ноября по март), сезон заканчивается в следующем календарном году. Время только
        подписывает, когда работу удобно делать: в этот час напоминание не приходит.
      </p>
    </fieldset>
  )
}

const num = (value: number | undefined) => (value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }))

/** Число в поле запаса: без разделителя тысяч, чтобы его можно было прочитать обратно. */
const stockText = (value: number | undefined) =>
  value === undefined ? '' : value.toLocaleString('ru-RU', { maximumFractionDigits: 3, useGrouping: false })

function WorkMaterials({
  consumableIds,
  stocks,
  times,
  areas,
  onAdd,
  onStock,
  onSave,
  onRemove,
  onEdit,
}: {
  consumableIds: string[]
  stocks: Record<string, string>
  times: number
  areas: { name: string; areaM2?: number }[]
  onAdd: (id: string) => Promise<void>
  onStock: (id: string, value: string) => void
  onSave: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onEdit: (id: string) => Promise<void>
}) {
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const selected = consumableIds
    .map((id) => consumables.find((item) => item.id === id))
    .filter((item): item is Consumable => !!item)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const available = consumables.filter((item) => item.active && !consumableIds.includes(item.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return (
    <fieldset className="periods">
      <legend>Материалы</legend>
      {selected.length === 0 && consumables.length > 0 && <p className="hint">К этой работе материалы не выбраны.</p>}
      {selected.map((item) => (
        <MaterialNeed
          key={item.id}
          item={item}
          stock={stocks[item.id] ?? ''}
          times={times}
          areas={areas}
          onStock={(value) => onStock(item.id, value)}
          onSave={() => onSave(item.id)}
          onRemove={() => onRemove(item.id)}
          onEdit={() => onEdit(item.id)}
        />
      ))}
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

function MaterialNeed({
  item,
  stock,
  times,
  areas,
  onStock,
  onSave,
  onRemove,
  onEdit,
}: {
  item: Consumable
  stock: string
  times: number
  areas: { name: string; areaM2?: number }[]
  onStock: (value: string) => void
  onSave: () => Promise<void>
  onRemove: () => Promise<void>
  onEdit: () => Promise<void>
}) {
  const stockInvalid = !!stock.trim() && parseNonNegative(stock) === undefined
  const plan = purchasePlan({
    unit: item.unit,
    ratePerM2: item.ratePerM2,
    rateUnit: item.rateUnit,
    applications: times,
    packQuantity: item.packQuantity,
    packUnit: item.packUnit,
    areas,
    usedThisYear: 0,
    pastUsage: [],
  })
  const packs = item.packQuantity ? plan.unitsNeed : undefined
  const buy = buyPackages(packs, parseNonNegative(stock))
  return (
    <div className="material-block">
      <div className="calc-grid">
        <p className="span">
          <button type="button" className="source-link button-link" onClick={() => void onEdit()}>
            {item.name}
          </button>
        </p>
        <label className="field">
          Количество внесений за 1 сезон
          <span className="result-line">
            <input aria-label={`Количество внесений ${item.name}`} readOnly value={times > 0 ? String(times) : ''} placeholder="—" />
            <span className="suffix">по расписанию</span>
          </span>
        </label>
        <label className="field">
          Требуется на 1 сезон
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
        {plan.formula && <p className="hint span">{plan.formula}</p>}
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

function WorkForm({ work, suggestion, settings, objects, onClose }: { work?: PlanWork; suggestion?: PlanSuggestion; settings: AppSettings; objects: { id: string; name: string; areaM2?: number }[]; onClose: () => void }) {
  const [title, setTitle] = useState(work?.title ?? suggestion?.title ?? '')
  const [workKind, setWorkKind] = useState(work?.workKind ?? suggestion?.workKind ?? '')
  const [objectIds, setObjectIds] = useState(work?.objectIds ?? suggestion?.objectIds ?? [])
  const [recurrence, setRecurrence] = useState<PlanWork['recurrence']>(work?.recurrence ?? 'yearly')
  const [periods, setPeriods] = useState<PlanPeriod[]>(work?.periods ?? (suggestion ? [{ month: Number(suggestion.lastDate.slice(5, 7)) }] : []))
  const [schedule, setSchedule] = useState<SeasonSchedule>(work?.seasonSchedule ?? defaultSchedule(suggestion?.lastDate))
  const [rhythm, setRhythm] = useState<'weeks' | 'days'>(work?.seasonSchedule?.weekdays?.length ? 'days' : 'weeks')
  const [conditionType, setConditionType] = useState<'' | WorkCondition['type']>(work?.condition?.type ?? '')
  const [leadDays, setLeadDays] = useState(String(work?.condition?.type === 'beforeAutumnFrost' ? work.condition.leadDays : 7))
  const [note, setNote] = useState(work?.note ?? '')
  const [consumableIds, setConsumableIds] = useState<string[]>(work?.consumableIds ?? [])
  const [workId, setWorkId] = useState(work?.id)
  const [revision, setRevision] = useState(work?.revision)
  const [stocks, setStocks] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [suggestionLinked, setSuggestionLinked] = useState(!suggestion || !!work)
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
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
  const areas = objects.filter((object) => objectIds.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 }))
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
    const condition: WorkCondition | undefined =
      recurrence === 'yearly' && conditionType === 'beforeAutumnFrost'
        ? { type: 'beforeAutumnFrost', leadDays: Math.max(1, Number(leadDays) || 7) }
        : recurrence === 'yearly' && conditionType === 'afterSpringFrost'
          ? { type: 'afterSpringFrost', weekday: 6, calmDays: 3 }
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
      plantGroupIds: work?.plantGroupIds ?? [],
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
        Повторение
        <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as PlanWork['recurrence'])}>
          <option value="yearly">Каждый год в это время</option>
          <option value="season">По расписанию в сезоне</option>
          <option value="once">Один раз</option>
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
      {recurrence === 'season' ? (
        <SeasonEditor schedule={schedule} rhythm={rhythm} onSchedule={setSchedule} onRhythm={setRhythm} />
      ) : (
        <PeriodsEditor periods={periods} onChange={setPeriods} />
      )}
      <WorkMaterials
        consumableIds={consumableIds}
        stocks={Object.fromEntries(consumableIds.map((id) => [id, stockOf(id)]))}
        times={times}
        areas={areas}
        onAdd={addMaterial}
        onStock={(id, value) => setStocks((current) => ({ ...current, [id]: value }))}
        onSave={saveStock}
        onRemove={removeMaterial}
        onEdit={openMaterial}
      />
      {recurrence === 'yearly' && (
      <label className="field">
        Условие
        <select value={conditionType} onChange={(event) => setConditionType(event.target.value as typeof conditionType)}>
          <option value="">Без условия — по срокам</option>
          <option value="beforeAutumnFrost">До первых осенних заморозков</option>
          <option value="afterSpringFrost">После весенних заморозков, в ближайшую субботу</option>
        </select>
      </label>
      )}
      {recurrence === 'yearly' && conditionType === 'beforeAutumnFrost' && (
        <label className="field">
          За сколько дней до заморозков напоминать
          <input inputMode="numeric" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
        </label>
      )}
      <label className="field">
        Примечание
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
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
      <p className="small muted">По архиву Open-Meteo для координат участка: заморозок — сутки, когда воздух на высоте 2 м остывал ниже 0 °C. Это модельная оценка, а не измерение на участке.</p>
    </details>
  )
}

export function WorksScreen({ settings }: { settings: AppSettings }) {
  const { list, works, context } = useWorkStatuses()
  const objects = useLiveQuery(() => db.objects.toArray(), []) ?? []
  const plantGroups = useLiveQuery(() => db.plantGroups.toArray(), []) ?? []
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const requested = useRoute().query.get('work')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id?: string; suggestion?: PlanSuggestion } | null>(requested ? { id: requested } : null)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  const close = () => {
    setEditing(null)
    if (requested) navigate('/works')
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
        <WorkForm key={editing.id ?? editing.suggestion?.key ?? 'new'} work={work} suggestion={editing.suggestion} settings={settings} objects={formObjects} onClose={close} />
      </Screen>
    )
  }

  const names = (ids: string[], source: { id: string; name: string }[]) => ids.map((id) => source.find((item) => item.id === id)?.name).filter(Boolean).join(', ')
  const objectNames = (ids: string[]) => names(ids, objects)
  const workText = (work: PlanWork, extra = '') =>
    [work.title, work.note, work.workKind, objectNames(work.objectIds), names(work.plantGroupIds, plantGroups), whenText(work), conditionText(work.condition), extra]
      .filter(Boolean)
      .join(' ')
  const archived = (works ?? []).filter((work) => !work.active && includesAllWords(query, workText(work)))
  const closed = list.filter(
    (item) => item.status.closed && includesAllWords(query, workText(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`)),
  )
  const allSuggestions = planSuggestions(events, context.today.slice(0, 4))
  const suggestions = allSuggestions.filter((item) => includesAllWords(query, [item.title, item.workKind, objectNames(item.objectIds)].filter(Boolean).join(' ')))
  const groups = GROUPS.map((group) => ({
    ...group,
    items: list.filter(
      (item) =>
        !item.status.closed &&
        group.states.includes(item.status.state) &&
        includesAllWords(query, workText(item.work, `${WORK_STATES[item.status.state]} ${item.status.message ?? ''}`)),
    ),
  })).filter((group) => group.items.length > 0)
  const hasWorks = (works?.length ?? 0) > 0 || allSuggestions.length > 0
  const visible = groups.length + suggestions.length + closed.length + archived.length

  return (
    <Screen title="План работ" help="works" back="/more" tab="/more">
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Работа
        </button>
        <a className="button secondary" href="#/plan">
          Из черновика Evernote
        </a>
      </div>
      <div className="search-row">
        <input
          type="search"
          placeholder="Поиск по названию, виду, объектам"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Поиск по плану работ"
        />
      </div>
      {!settings.plotLocation && (
        <p className="hint">
          Для работ, зависящих от заморозков, нужны координаты участка: <a href="#/settings">«Ещё → Настройки → Участок»</a>.
        </p>
      )}
      <ClimateNote />
      {works && !hasWorks && <EmptyState>Работ пока нет. Добавьте свою или перенесите из черновика Evernote.</EmptyState>}
      {works && hasWorks && visible === 0 && <EmptyState>Ничего не найдено. Измените поиск.</EmptyState>}
      {groups.map((group) => (
        <section key={group.title}>
          <h2 className="section-title">{group.title}</h2>
          {group.title === 'Пропущено в этом году' && (
            <p className="hint">Если пропустили по ошибке — «Вернуть в этот год». Сама работа из плана не удаляется.</p>
          )}
          <ul className="list">
            {group.items.map((item) => (
              <WorkItem key={item.work.id} {...item} today={context.today} objectNames={objectNames(item.work.objectIds)} onEdit={() => setEditing({ id: item.work.id })} />
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
            {closed.map((item) => (
              <li key={item.work.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ id: item.work.id })}>
                  <strong>{item.work.title}</strong>
                  <span className="muted">сделано и не повторяется</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {archived.length > 0 && (
        <section>
          <h2 className="section-title">Архив</h2>
          <ul className="list">
            {archived.map((work) => (
              <li key={work.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ id: work.id })}>
                  <strong>{work.title}</strong>
                  <span className="muted">в архиве, история сохранена</span>
                </button>
              </li>
            ))}
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

