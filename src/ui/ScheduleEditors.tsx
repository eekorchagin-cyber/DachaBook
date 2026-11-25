import { MONTH_NAMES } from '../domain/dates'
import type { PlanPeriod, SeasonSchedule } from '../domain/types'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function defaultSchedule(date?: string): SeasonSchedule {
  const month = date ? Number(date.slice(5, 7)) : new Date().getMonth() + 1
  const day = date ? Number(date.slice(8, 10)) : new Date().getDate()
  const toMonth = Math.min(12, Math.max(month, 9))
  const toDay = toMonth === month ? Math.max(day, 28) : toMonth === 9 ? 30 : 28
  return { fromMonth: month, fromDay: day, toMonth, toDay, everyWeeks: 2 }
}

function dayExists(month: number, day: number): boolean {
  return day >= 1 && day <= 31 && new Date(Date.UTC(2024, month - 1, day)).getUTCDate() === day
}

export function scheduleProblem(schedule: SeasonSchedule, rhythm: 'weeks' | 'days'): string {
  if (!dayExists(schedule.fromMonth, schedule.fromDay) || !dayExists(schedule.toMonth, schedule.toDay)) return 'В этом месяце нет такого дня.'
  if (rhythm === 'days' && !(schedule.weekdays ?? []).length) return 'Выберите хотя бы один день недели.'
  if (schedule.timeTo && !schedule.timeFrom) return 'Укажите время начала.'
  if (schedule.timeFrom && schedule.timeTo && schedule.timeFrom > schedule.timeTo) return 'Время окончания раньше начала.'
  return ''
}

function patchSchedule(schedule: SeasonSchedule, patch: Partial<SeasonSchedule>): SeasonSchedule {
  return { ...schedule, ...patch }
}

export function PeriodsEditor({
  periods,
  onChange,
  legend = 'Когда в году',
}: {
  periods: PlanPeriod[]
  onChange: (periods: PlanPeriod[]) => void
  legend?: string
}) {
  return (
    <fieldset className="periods">
      <legend>{legend}</legend>
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

export function SeasonEditor({
  schedule,
  rhythm,
  onSchedule,
  onRhythm,
  legend = 'Повтор в сезоне',
}: {
  schedule: SeasonSchedule
  rhythm: 'weeks' | 'days'
  onSchedule: (schedule: SeasonSchedule) => void
  onRhythm: (rhythm: 'weeks' | 'days') => void
  legend?: string
}) {
  const toggleDay = (day: number) => {
    const days = schedule.weekdays ?? []
    onSchedule(patchSchedule(schedule, { weekdays: days.includes(day) ? days.filter((item) => item !== day) : [...days, day] }))
  }
  const bound = (key: 'from' | 'to', month: number, day: number) =>
    onSchedule(key === 'from' ? patchSchedule(schedule, { fromMonth: month, fromDay: day }) : patchSchedule(schedule, { toMonth: month, toDay: day }))
  return (
    <fieldset className="periods">
      <legend>{legend}</legend>
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
      <div className="period-row period-row--times">
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
        Окно повторяется каждый год. Дата «по 30 сентября» — граница окна, а не день работы: при повторе по субботам последний раз приходится на последнюю субботу сентября. Если
        окончание раньше начала (уборка снега с ноября по март), сезон заканчивается в следующем календарном году. Время только подписывает, когда работу удобно делать: в этот час
        напоминание не приходит.
      </p>
    </fieldset>
  )
}
