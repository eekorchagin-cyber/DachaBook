import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { repo } from '../app/store'
import { todayAtSite } from '../domain/dates'
import { consumptionByMonth, DEFAULT_UTILITY_UNIT, UTILITY_KIND_LABEL } from '../domain/utilityMeters'
import type { DocInput, UtilityKind, UtilityMeter, UtilityReading } from '../domain/types'
import { errorText } from '../lib/format'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const KINDS: UtilityKind[] = ['water', 'electricity', 'gas', 'other']

function MeterForm({ meter, onClose }: { meter?: UtilityMeter; onClose: () => void }) {
  const [name, setName] = useState(meter?.name ?? '')
  const [kind, setKind] = useState<UtilityKind>(meter?.kind ?? 'water')
  const [unit, setUnit] = useState(meter?.unit ?? DEFAULT_UTILITY_UNIT.water)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    const title = name.trim()
    if (!title) {
      setError('Укажите название счётчика.')
      return
    }
    const input: DocInput<UtilityMeter> = {
      name: title,
      kind,
      unit: unit.trim() || DEFAULT_UTILITY_UNIT[kind],
      active: meter?.active ?? true,
    }
    if (meter) await repo.update('utilityMeters', meter.id, input, meter.revision)
    else await repo.create('utilityMeters', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{meter ? 'Изменить счётчик' : 'Новый счётчик'}</h2>
      <label className="field">
        Название
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Вода в доме, электричество…" />
      </label>
      <label className="field">
        Тип
        <select
          value={kind}
          onChange={(event) => {
            const next = event.target.value as UtilityKind
            setKind(next)
            if (!meter || unit === DEFAULT_UTILITY_UNIT[meter.kind]) setUnit(DEFAULT_UTILITY_UNIT[next])
          }}
        >
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {UTILITY_KIND_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Единица
        <input value={unit} onChange={(event) => setUnit(event.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton onRun={save}>Сохранить</ActionButton>
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

function ConsumptionChart({ months, unit }: { months: { month: string; used: number }[]; unit: string }) {
  if (months.length === 0) return <p className="hint">Нужны хотя бы два показания, чтобы увидеть расход.</p>
  const width = 360
  const height = 160
  const pad = { top: 16, right: 16, bottom: 28, left: 40 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const max = Math.max(...months.map((item) => item.used), 0.001)
  const barW = Math.max(innerW / months.length - 4, 6)
  const x = (index: number) => pad.left + ((index + 0.5) / months.length) * innerW

  return (
    <svg className="climate-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Расход, ${unit}`}>
      {months.map((item, index) => {
        const barH = (item.used / max) * innerH
        return (
          <g key={item.month}>
            <rect className="climate-precip" x={x(index) - barW / 2} y={pad.top + innerH - barH} width={barW} height={Math.max(barH, 0)} rx={2} />
            <text className="climate-label" x={x(index)} y={height - 8} textAnchor="middle">
              {item.month.slice(5)}
            </text>
          </g>
        )
      })}
      <text className="climate-axis" x={pad.left - 6} y={pad.top + 4} textAnchor="end">
        {max}
      </text>
      <text className="climate-axis" x={pad.left - 6} y={pad.top + innerH} textAnchor="end">
        0
      </text>
    </svg>
  )
}

function MeterDetail({ meter, readings, onBack }: { meter: UtilityMeter; readings: UtilityReading[]; onBack: () => void }) {
  const [date, setDate] = useState(todayAtSite().date)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const sorted = useMemo(
    () => [...readings].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [readings],
  )
  const months = useMemo(() => consumptionByMonth(readings), [readings])
  const usedById = useMemo(() => {
    const asc = [...readings].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    const map = new Map<string, number>()
    for (let index = 1; index < asc.length; index++) {
      const used = asc[index].value - asc[index - 1].value
      if (used > 0) map.set(asc[index].id, used)
    }
    return map
  }, [readings])

  const addReading = async () => {
    setError('')
    const number = Number(value.replace(',', '.'))
    if (!date || !Number.isFinite(number)) {
      setError('Укажите дату и показание.')
      return
    }
    await repo.create('utilityReadings', {
      meterId: meter.id,
      date,
      value: number,
      note: note.trim() || undefined,
    })
    setValue('')
    setNote('')
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="button secondary" onClick={onBack}>
          ← К счётчикам
        </button>
      </div>
      <h2>
        {meter.name}{' '}
        <span className="muted small">
          {UTILITY_KIND_LABEL[meter.kind]} · {meter.unit}
        </span>
      </h2>
      <section className="card">
        <h3>Новое показание</h3>
        <label className="field">
          Дата
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="field">
          Показание ({meter.unit})
          <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Нарастающий итог" />
        </label>
        <label className="field">
          Примечание
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <ActionButton onRun={addReading}>Записать</ActionButton>
      </section>
      <h3>Расход по месяцам</h3>
      <ConsumptionChart months={months} unit={meter.unit} />
      <h3>Журнал</h3>
      {sorted.length === 0 ? (
        <EmptyState>Показаний ещё нет.</EmptyState>
      ) : (
        <ul className="list">
          {sorted.map((reading) => {
            const used = usedById.get(reading.id)
            return (
              <li key={reading.id} className="list-item">
                <strong>
                  {reading.date}: {reading.value} {meter.unit}
                </strong>
                {used !== undefined && (
                  <p className="small muted">
                    Расход с прошлого: {used} {meter.unit}
                  </p>
                )}
                {reading.note && <p className="small">{reading.note}</p>}
                <ActionButton
                  secondary
                  onRun={async () => {
                    if (!confirm('Удалить показание?')) return
                    await repo.remove('utilityReadings', reading.id, reading.revision)
                  }}
                >
                  Удалить
                </ActionButton>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function MetersScreen() {
  const meters = useLiveQuery(() => db.utilityMeters.filter((item) => !item.deletedAt).toArray(), [])
  const readings = useLiveQuery(() => db.utilityReadings.filter((item) => !item.deletedAt).toArray(), [])
  const [editing, setEditing] = useState<UtilityMeter | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const list = useMemo(
    () => [...(meters ?? [])].filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [meters],
  )
  const selected = list.find((item) => item.id === selectedId) ?? null
  const selectedReadings = (readings ?? []).filter((item) => item.meterId === selectedId)

  if (selected) {
    return (
      <Screen title={selected.name} help="meters" back="/meters" tab="/more">
        <MeterDetail meter={selected} readings={selectedReadings} onBack={() => setSelectedId(null)} />
      </Screen>
    )
  }

  return (
    <Screen title="Счётчики" help="meters" back="/more" tab="/more">
      <p className="hint">Вода, электричество, газ: журнал показаний и расход по месяцам. Расход — разница с предыдущим показанием.</p>
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing(null)}>
          Добавить счётчик
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {editing !== undefined && <MeterForm meter={editing ?? undefined} onClose={() => setEditing(undefined)} />}
      {meters && list.length === 0 && editing === undefined && <EmptyState>Счётчиков пока нет.</EmptyState>}
      <ul className="list">
        {list.map((meter) => {
          const count = (readings ?? []).filter((item) => item.meterId === meter.id).length
          return (
            <li key={meter.id} className="list-item">
              <button type="button" className="work-title" onClick={() => setSelectedId(meter.id)}>
                <strong>{meter.name}</strong>
              </button>
              <p className="small muted">
                {UTILITY_KIND_LABEL[meter.kind]} · {meter.unit} · показаний: {count}
              </p>
              <div className="actions">
                <button type="button" className="button small" onClick={() => setSelectedId(meter.id)}>
                  Журнал
                </button>
                <button type="button" className="button secondary small" onClick={() => setEditing(meter)}>
                  Изменить
                </button>
                <ActionButton
                  secondary
                  onRun={async () => {
                    setError('')
                    try {
                      await repo.update('utilityMeters', meter.id, { active: false }, meter.revision)
                    } catch (caught) {
                      setError(errorText(caught))
                    }
                  }}
                >
                  Скрыть
                </ActionButton>
              </div>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}
