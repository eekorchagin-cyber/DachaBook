import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../app/router'
import { repo, type AppSettings } from '../app/store'
import { MONTH_NAMES, todayAtSite } from '../domain/dates'
import type { CareObject, DocInput, WateringKind, WateringZone } from '../domain/types'
import { dateText } from '../plan/frost'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { useForecast } from '../weather/service'
import { skipWateringToday, undoWateringSkip } from '../watering/actions'
import {
  isWateringUpcoming,
  WATERING_KINDS,
  WATERING_STATES,
  wateringHistory,
  wateringStatus,
  WEEKDAYS_SHORT,
  zoneScheduleText,
  type WateringState,
  type WateringStatus,
} from '../watering/status'

const STATUS_ORDER: Record<WateringState, number> = {
  ready: 0,
  rain: 1,
  skipped: 2,
  soon: 3,
  planned: 4,
  done: 5,
  off: 6,
}

const KINDS: WateringKind[] = ['sprinkler', 'drip', 'hose', 'other']

function precipitationMap(daily?: { time: string[]; precipitation_sum: (number | null)[] }): Record<string, number> {
  if (!daily) return {}
  return Object.fromEntries(daily.time.map((date, index) => [date, daily.precipitation_sum[index] ?? 0]))
}

function ZoneItem({
  zone,
  status,
  history,
  objectNames,
  today,
  onEdit,
}: {
  zone: WateringZone
  status: WateringStatus
  history: string[]
  objectNames: string
  today: string
  onEdit: () => void
}) {
  const past = history.filter((date) => date < today).slice(0, 4)
  return (
    <li className={`work-item work-${status.state}${status.state === 'ready' ? ' urgent' : ''}`}>
      <button type="button" className="work-title" onClick={onEdit}>
        <strong>{zone.name}</strong>
      </button>
      <p className="small">
        <span className={`work-state state-${status.state}`}>
          {WATERING_STATES[status.state]}
        </span>
        {status.message && ` — ${status.message}`}
      </p>
      <p className="small muted">{[WATERING_KINDS[zone.kind], zoneScheduleText(zone), objectNames].filter(Boolean).join(' · ')}</p>
      {past.length > 0 && <p className="small muted">По дневнику: {past.map((date) => dateText(date)).join('; ')}</p>}
      <div className="actions">
        {status.state !== 'done' && (
          <button type="button" className="button small" onClick={() => navigate(`/diary/new?water=${zone.id}`)}>
            Полито
          </button>
        )}
        {(status.state === 'ready' || status.state === 'rain') && (
          <ActionButton secondary onRun={() => skipWateringToday(zone.id, today)}>
            Пропустить сегодня
          </ActionButton>
        )}
        {status.state === 'skipped' && (
          <ActionButton secondary onRun={() => undoWateringSkip(zone.id, today)}>
            Отменить пропуск
          </ActionButton>
        )}
        <button type="button" className="button secondary small" onClick={onEdit}>
          Изменить
        </button>
      </div>
    </li>
  )
}

function ZoneForm({ zone, objects, onClose }: { zone?: WateringZone; objects: CareObject[]; onClose: () => void }) {
  const [name, setName] = useState(zone?.name ?? '')
  const [kind, setKind] = useState<WateringKind>(zone?.kind ?? 'sprinkler')
  const [objectIds, setObjectIds] = useState(zone?.objectIds ?? [])
  const [weekdays, setWeekdays] = useState(zone?.weekdays ?? [1, 4])
  const [durationMin, setDurationMin] = useState(String(zone?.durationMin ?? 20))
  const [timeFrom, setTimeFrom] = useState(zone?.timeFrom ?? '')
  const [fromMonth, setFromMonth] = useState(zone?.fromMonth ?? 5)
  const [fromDay, setFromDay] = useState(zone?.fromDay ?? 1)
  const [toMonth, setToMonth] = useState(zone?.toMonth ?? 9)
  const [toDay, setToDay] = useState(zone?.toDay ?? 30)
  const [skipRainMm, setSkipRainMm] = useState(String(zone?.skipRainMm ?? 5))
  const [areaM2, setAreaM2] = useState(zone?.areaM2?.toString() ?? '')
  const [dripLineM, setDripLineM] = useState(zone?.dripLineM?.toString() ?? '')
  const [soil, setSoil] = useState(zone?.soil ?? '')
  const [flowLpm, setFlowLpm] = useState(zone?.flowLpm?.toString() ?? '')
  const [note, setNote] = useState(zone?.note ?? '')
  const toggle = (id: string) => setObjectIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  const toggleDay = (day: number) => setWeekdays((days) => (days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b)))

  const save = async (active = zone?.active ?? true) => {
    const input: DocInput<WateringZone> = {
      name: name.trim(),
      kind,
      objectIds,
      plantGroupIds: zone?.plantGroupIds ?? [],
      areaM2: Number(areaM2) || undefined,
      dripLineM: Number(dripLineM) || undefined,
      soil: soil.trim() || undefined,
      flowLpm: Number(flowLpm) || undefined,
      weekdays,
      durationMin: Math.max(1, Number(durationMin) || 20),
      timeFrom: timeFrom || undefined,
      fromMonth,
      fromDay: Math.max(1, Math.min(31, Number(fromDay) || 1)),
      toMonth,
      toDay: Math.max(1, Math.min(31, Number(toDay) || 1)),
      skipRainMm: Math.max(0, Number(skipRainMm) || 0),
      skippedDates: zone?.skippedDates,
      note: note.trim() || undefined,
      active,
    }
    if (zone) await repo.update('wateringZones', zone.id, input, zone.revision)
    else await repo.create('wateringZones', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{zone ? 'Изменить зону' : 'Новая зона полива'}</h2>
      <label className="field">
        Название
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Газон, сад, грядки…" />
      </label>
      <label className="field">
        Как поливаем
        <select value={kind} onChange={(event) => setKind(event.target.value as WateringKind)}>
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {WATERING_KINDS[item]}
            </option>
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
      <fieldset className="periods">
        <legend>Дни полива</legend>
        <div className="chips">
          {WEEKDAYS_SHORT.map((label, index) => {
            const day = index + 1
            return (
              <button key={label} type="button" className={weekdays.includes(day) ? 'chip active' : 'chip'} onClick={() => toggleDay(day)}>
                {label}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div className="row">
        <label className="field">
          Длительность, мин
          <input inputMode="numeric" value={durationMin} onChange={(event) => setDurationMin(event.target.value)} />
        </label>
        <label className="field">
          Время
          <input type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} />
        </label>
      </div>
      <div className="period-row">
        <span className="small">Сезон с</span>
        <select aria-label="Месяц начала" value={fromMonth} onChange={(event) => setFromMonth(Number(event.target.value))}>
          {MONTH_NAMES.map((label, month) => (
            <option key={label} value={month + 1}>
              {label}
            </option>
          ))}
        </select>
        <input aria-label="День начала" inputMode="numeric" value={fromDay} onChange={(event) => setFromDay(Number(event.target.value))} />
      </div>
      <div className="period-row">
        <span className="small">по</span>
        <select aria-label="Месяц окончания" value={toMonth} onChange={(event) => setToMonth(Number(event.target.value))}>
          {MONTH_NAMES.map((label, month) => (
            <option key={label} value={month + 1}>
              {label}
            </option>
          ))}
        </select>
        <input aria-label="День окончания" inputMode="numeric" value={toDay} onChange={(event) => setToDay(Number(event.target.value))} />
      </div>
      <label className="field">
        Не поливать, если осадки вчера+сегодня, мм
        <input inputMode="decimal" value={skipRainMm} onChange={(event) => setSkipRainMm(event.target.value)} />
      </label>
      <div className="row">
        <label className="field">
          Площадь, м²
          <input inputMode="decimal" value={areaM2} onChange={(event) => setAreaM2(event.target.value)} />
        </label>
        <label className="field">
          Капля, м линии
          <input inputMode="decimal" value={dripLineM} onChange={(event) => setDripLineM(event.target.value)} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          Производительность, л/мин
          <input inputMode="decimal" value={flowLpm} onChange={(event) => setFlowLpm(event.target.value)} />
        </label>
        <label className="field">
          Почва
          <input value={soil} onChange={(event) => setSoil(event.target.value)} placeholder="суглинок, песок…" />
        </label>
      </div>
      <label className="field">
        Примечание
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="actions">
        <ActionButton disabled={!name.trim() || weekdays.length === 0} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {zone && (
          <ActionButton secondary onRun={() => save(!zone.active)}>
            {zone.active ? 'Убрать из полива' : 'Вернуть'}
          </ActionButton>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

export function WateringScreen({ settings }: { settings: AppSettings }) {
  const zones = useLiveQuery(() => db.wateringZones.filter((zone) => !zone.deletedAt).toArray(), [])
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const { forecast } = useForecast()
  const today = todayAtSite().date
  const precipitation = useMemo(() => precipitationMap(forecast?.daily), [forecast])
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  if (editing) {
    return (
      <Screen title="Полив" help="watering" onBack={() => setEditing(null)} tab="/more">
        <ZoneForm key={editing.id ?? 'new'} zone={zones?.find((item) => item.id === editing.id)} objects={objects} onClose={() => setEditing(null)} />
      </Screen>
    )
  }

  const names = (ids: string[]) => ids.map((id) => objects.find((object) => object.id === id)?.name).filter(Boolean).join(', ')
  const active = (zones ?? []).filter((zone) => zone.active)
  const archived = (zones ?? []).filter((zone) => !zone.active)
  const list = active
    .map((zone) => {
      const history = wateringHistory(zone, events)
      return { zone, history, status: wateringStatus(zone, history, { today, precipitation }) }
    })
    .sort((a, b) => STATUS_ORDER[a.status.state] - STATUS_ORDER[b.status.state] || a.zone.name.localeCompare(b.zone.name, 'ru'))

  return (
    <Screen title="Полив" help="watering" back="/more" tab="/more">
      <p className="hint">
        Три независимые зоны — газон, сад и грядки. Рекомендация смотрит на расписание и осадки Open-Meteo. «Полито» открывает запись дневника. Координаты
        участка: {settings.plotLocation ? 'заданы' : 'не заданы — «Ещё → Настройки → Участок»'}.
      </p>
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Зона
        </button>
      </div>
      {zones && active.length === 0 && <EmptyState>Зон пока нет. Добавьте газон, сад или грядки.</EmptyState>}
      {list.length > 0 && (
        <ul className="list">
          {list.map((item) => (
            <ZoneItem key={item.zone.id} {...item} today={today} objectNames={names(item.zone.objectIds)} onEdit={() => setEditing({ id: item.zone.id })} />
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <section>
          <h2 className="section-title">Архив</h2>
          <ul className="list">
            {archived.map((zone) => (
              <li key={zone.id}>
                <button type="button" className="list-item" onClick={() => setEditing({ id: zone.id })}>
                  <strong>{zone.name}</strong>
                  <span className="muted">в архиве</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}

/** Карточка на главном экране: что полить сегодня и в ближайшие дни, с учётом дождя. */
export function UpcomingWateringCard() {
  const zones = useLiveQuery(() => db.wateringZones.filter((zone) => !zone.deletedAt && zone.active).toArray(), [])
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const { forecast } = useForecast()
  const today = todayAtSite().date
  const precipitation = useMemo(() => precipitationMap(forecast?.daily), [forecast])
  const upcoming = (zones ?? [])
    .map((zone) => {
      const history = wateringHistory(zone, events)
      return { zone, status: wateringStatus(zone, history, { today, precipitation }) }
    })
    .filter((item) => isWateringUpcoming(item.status))
    .sort((a, b) => STATUS_ORDER[a.status.state] - STATUS_ORDER[b.status.state] || a.zone.name.localeCompare(b.zone.name, 'ru'))
    .slice(0, 5)
  if (!zones || zones.length === 0) return null
  return (
    <section className="card">
      <div className="card-header">
        <h2>Полив</h2>
        <a className="small source-link" href="#/watering">
          Все зоны
        </a>
      </div>
      {upcoming.length === 0 ? (
        <p className="hint">Сегодня поливать не нужно. Зоны — в «Ещё → Полив».</p>
      ) : (
        <ul className="upcoming">
          {upcoming.map(({ zone, status }) => (
            <li key={zone.id}>
              <a href="#/watering">
                <strong>{zone.name}</strong>
              </a>
              <span className="small">
                <span className={`work-state state-${status.state}`}>{WATERING_STATES[status.state]}</span>
                {status.message && ` — ${status.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
