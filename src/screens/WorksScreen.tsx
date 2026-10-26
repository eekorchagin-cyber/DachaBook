import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { navigate } from '../app/router'
import { repo, type AppSettings } from '../app/store'
import { MONTH_NAMES } from '../domain/dates'
import { periodText } from '../domain/labels'
import type { DocInput, PlanPeriod, PlanWork, WorkCondition } from '../domain/types'
import { setSeason } from '../plan/actions'
import { useWorkContext } from '../plan/context'
import { useWorkStatuses } from '../plan/useWorkStatuses'
import { dateText } from '../plan/frost'
import { WORK_STATES, type WorkStatus } from '../plan/status'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const GROUPS: { title: string; states: WorkStatus['state'][] }[] = [
  { title: 'Сейчас', states: ['overdue', 'ready'] },
  { title: 'Ждёт условий', states: ['waiting', 'check'] },
  { title: 'Скоро и позже', states: ['soon', 'postponed', 'planned'] },
  { title: 'Выполнено в этом году', states: ['done', 'skipped'] },
]

const conditionText = (condition?: WorkCondition) =>
  !condition
    ? ''
    : condition.type === 'beforeAutumnFrost'
      ? `за ${condition.leadDays} дн. до первых осенних заморозков`
      : `после весенних заморозков${condition.weekday === 6 ? ', в субботу' : ''}`

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
  const currentYear = today.slice(0, 4)
  const [postpone, setPostpone] = useState<string | null>(null)
  const past = historyText(history, currentYear)
  const marked = !!work.seasons[currentYear]
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
        {[periodText(work.periods), conditionText(work.condition), objectNames, work.workKind].filter(Boolean).join(' · ')}
      </p>
      {past && <p className="small muted">По дневнику в прошлые годы: {past}</p>}
      {postpone !== null ? (
        <div className="actions">
          <input type="date" value={postpone} onChange={(event) => setPostpone(event.target.value)} aria-label="Новая дата" />
          <ActionButton
            disabled={!postpone}
            onRun={async () => {
              await setSeason(work.id, postpone!.slice(0, 4), { status: 'postponed', date: postpone! })
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
          {status.state !== 'done' && status.state !== 'skipped' && !(work.condition && status.state === 'planned') && (
            <>
              <button type="button" className="button small" onClick={() => navigate(`/diary/new?plan=${work.id}`)}>
                Выполнено
              </button>
              <button type="button" className="button secondary small" onClick={() => setPostpone(status.date && status.date > today ? status.date : '')}>
                Перенести
              </button>
              <ActionButton secondary onRun={() => setSeason(work.id, currentYear, { status: 'skipped' })}>
                Пропустить в этом году
              </ActionButton>
            </>
          )}
          {marked && (
            <ActionButton secondary onRun={() => setSeason(work.id, currentYear, null)}>
              Снять отметку
            </ActionButton>
          )}
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

function WorkForm({ work, settings, onClose }: { work?: PlanWork; settings: AppSettings; onClose: () => void }) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const [title, setTitle] = useState(work?.title ?? '')
  const [workKind, setWorkKind] = useState(work?.workKind ?? '')
  const [objectIds, setObjectIds] = useState(work?.objectIds ?? [])
  const [periods, setPeriods] = useState<PlanPeriod[]>(work?.periods ?? [])
  const [conditionType, setConditionType] = useState<'' | WorkCondition['type']>(work?.condition?.type ?? '')
  const [leadDays, setLeadDays] = useState(String(work?.condition?.type === 'beforeAutumnFrost' ? work.condition.leadDays : 7))
  const [note, setNote] = useState(work?.note ?? '')
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const save = async (active = work?.active ?? true) => {
    const condition: WorkCondition | undefined =
      conditionType === 'beforeAutumnFrost'
        ? { type: 'beforeAutumnFrost', leadDays: Math.max(1, Number(leadDays) || 7) }
        : conditionType === 'afterSpringFrost'
          ? { type: 'afterSpringFrost', weekday: 6, calmDays: 3 }
          : undefined
    const input: DocInput<PlanWork> = {
      title: title.trim(),
      workKind: workKind || undefined,
      objectIds,
      plantGroupIds: work?.plantGroupIds ?? [],
      note: note.trim() || undefined,
      recurrence: work?.recurrence ?? 'yearly',
      periods,
      condition,
      historyWords: work?.historyWords,
      sourceDraftId: work?.sourceDraftId,
      seasons: work?.seasons ?? {},
      active,
    }
    if (work) await repo.update('planWorks', work.id, input, work.revision)
    else await repo.create('planWorks', input)
    onClose()
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
      <PeriodsEditor periods={periods} onChange={setPeriods} />
      <label className="field">
        Условие
        <select value={conditionType} onChange={(event) => setConditionType(event.target.value as typeof conditionType)}>
          <option value="">Без условия — по срокам</option>
          <option value="beforeAutumnFrost">До первых осенних заморозков</option>
          <option value="afterSpringFrost">После весенних заморозков, в ближайшую субботу</option>
        </select>
      </label>
      {conditionType === 'beforeAutumnFrost' && (
        <label className="field">
          За сколько дней до заморозков напоминать
          <input inputMode="numeric" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
        </label>
      )}
      <label className="field">
        Примечание
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="actions">
        <ActionButton disabled={!title.trim()} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {work && (
          <ActionButton secondary onRun={() => save(!work.active)}>
            {work.active ? 'В архив' : 'Вернуть из архива'}
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
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  if (editing) {
    return (
      <Screen title="План работ" help="works" onBack={() => setEditing(null)} tab="/more">
        <WorkForm key={editing.id ?? 'new'} work={works?.find((work) => work.id === editing.id)} settings={settings} onClose={() => setEditing(null)} />
      </Screen>
    )
  }

  const names = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const archived = (works ?? []).filter((work) => !work.active)

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
      {!settings.plotLocation && (
        <p className="hint">
          Для работ, зависящих от заморозков, нужны координаты участка: <a href="#/settings">«Ещё → Настройки → Участок»</a>.
        </p>
      )}
      <ClimateNote />
      {works && list.length === 0 && <EmptyState>Работ пока нет. Добавьте свою или перенесите из черновика Evernote.</EmptyState>}
      {GROUPS.map((group) => {
        const items = list.filter((item) => group.states.includes(item.status.state))
        if (items.length === 0) return null
        return (
          <section key={group.title}>
            <h2 className="section-title">{group.title}</h2>
            <ul className="list">
              {items.map((item) => (
                <WorkItem key={item.work.id} {...item} today={context.today} objectNames={names(item.work.objectIds)} onEdit={() => setEditing({ id: item.work.id })} />
              ))}
            </ul>
          </section>
        )
      })}
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
  const upcoming = list.filter((item) => ['overdue', 'ready', 'waiting', 'check', 'soon'].includes(item.status.state)).slice(0, 5)
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

