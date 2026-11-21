import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { getSetting } from '../app/store'
import type { YearClimate } from '../domain/monthlyClimate'
import { monthLabel } from '../domain/monthlyClimate'
import { errorText } from '../lib/format'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { MONTHLY_CLIMATE_YEARS, readMonthlyClimate, refreshMonthlyClimate, type StoredMonthlyClimate } from '../weather/monthlyClimate'
import { useForecast } from '../weather/service'

/** Столбцы осадков и линия средней температуры по месяцам выбранного года. */
function ClimateChart({ year }: { year: YearClimate }) {
  const width = 360
  const height = 200
  const pad = { top: 16, right: 36, bottom: 28, left: 36 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const temps = year.months.map((month) => month.tAvg).filter((value): value is number => value !== null)
  const precips = year.months.map((month) => month.precipMm).filter((value): value is number => value !== null)
  const tMin = temps.length ? Math.min(...temps, 0) - 2 : -10
  const tMax = temps.length ? Math.max(...temps, 0) + 2 : 20
  const pMax = Math.max(...precips, 10)
  const x = (index: number) => pad.left + ((index + 0.5) / 12) * innerW
  const yTemp = (value: number) => pad.top + ((tMax - value) / (tMax - tMin || 1)) * innerH
  const barW = innerW / 12 - 4
  const points = year.months
    .map((month, index) => (month.tAvg === null ? null : `${x(index)},${yTemp(month.tAvg)}`))
    .filter(Boolean)
    .join(' ')

  return (
    <svg className="climate-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Климат ${year.year}`}>
      <line x1={pad.left} y1={yTemp(0)} x2={width - pad.right} y2={yTemp(0)} className="climate-zero" />
      {year.months.map((month, index) => {
        const precip = month.precipMm ?? 0
        const barH = (precip / pMax) * innerH * 0.85
        return (
          <rect
            key={month.month}
            className="climate-precip"
            x={x(index) - barW / 2}
            y={pad.top + innerH - barH}
            width={barW}
            height={Math.max(barH, 0)}
            rx={2}
          />
        )
      })}
      {points && <polyline className="climate-temp" fill="none" points={points} />}
      {year.months.map((month, index) =>
        month.tAvg === null ? null : <circle key={`t-${month.month}`} className="climate-temp-dot" cx={x(index)} cy={yTemp(month.tAvg)} r={3} />,
      )}
      {year.months.map((month, index) => (
        <text key={`m-${month.month}`} className="climate-label" x={x(index)} y={height - 8} textAnchor="middle">
          {monthLabel(month.month)}
        </text>
      ))}
      <text className="climate-axis" x={pad.left - 6} y={pad.top + 4} textAnchor="end">
        {Math.round(tMax)}°
      </text>
      <text className="climate-axis" x={pad.left - 6} y={pad.top + innerH} textAnchor="end">
        {Math.round(tMin)}°
      </text>
      <text className="climate-axis" x={width - pad.right + 6} y={pad.top + 4}>
        {Math.round(pMax)} мм
      </text>
    </svg>
  )
}

/** Пять лет температуры и осадков по месяцам для координат участка. */
export function ClimateScreen() {
  const { location } = useForecast()
  const plot = useLiveQuery(() => getSetting('plotLocation'), [])
  const place = location ?? plot ?? null
  const [stored, setStored] = useState<StoredMonthlyClimate | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const years = stored?.years ?? []
  const [year, setYear] = useState<number | null>(null)
  const selected = useMemo(() => years.find((item) => item.year === year) ?? years.at(-1), [years, year])

  useEffect(() => {
    let alive = true
    void readMonthlyClimate(place).then((value) => {
      if (alive) setStored(value ?? null)
    })
    return () => {
      alive = false
    }
  }, [place?.latitude, place?.longitude])

  useEffect(() => {
    if (years.length && (year === null || !years.some((item) => item.year === year))) setYear(years.at(-1)!.year)
  }, [years, year])

  const load = async () => {
    setError('')
    setLoading(true)
    try {
      const next = await refreshMonthlyClimate()
      setStored(next)
      if (next?.years.length) setYear(next.years.at(-1)!.year)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!place || stored !== null) return
    void load()
  }, [place, stored])

  return (
    <Screen title="Климат участка" help="climate" back="/more/works" tab="/more">
      <p className="hint">
        Средняя температура и сумма осадков по месяцам за {MONTHLY_CLIMATE_YEARS} полных лет. Данные Open-Meteo для координат участка — модельная оценка, не измерение на грядке.
      </p>
      {!place && (
        <p className="hint">
          Укажите координаты участка: <a href="#/settings?part=plot">«Ещё → Настройки программы → Участок»</a>.
        </p>
      )}
      {place && (
        <div className="actions">
          <ActionButton disabled={loading} onRun={load}>
            {loading ? 'Загружаю…' : stored ? 'Обновить архив' : 'Загрузить архив'}
          </ActionButton>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {stored && (
        <p className="muted small">
          Годы {stored.fromYear}–{stored.toYear}. Обновлено {new Date(stored.computedAt).toLocaleString('ru-RU')}.
        </p>
      )}
      {years.length > 0 && (
        <div className="jump-row" role="group" aria-label="Год">
          {years.map((item) => (
            <button key={item.year} type="button" className={item.year === selected?.year ? 'chip active' : 'chip'} onClick={() => setYear(item.year)}>
              {item.year}
            </button>
          ))}
        </div>
      )}
      {selected && <ClimateChart year={selected} />}
      {selected && (
        <ul className="climate-legend">
          <li>
            <span className="climate-swatch temp" /> средняя температура, °C
          </li>
          <li>
            <span className="climate-swatch precip" /> осадки за месяц, мм
          </li>
        </ul>
      )}
      {selected && (
        <details className="card">
          <summary>
            <strong>Цифры {selected.year}</strong>
          </summary>
          <table className="climate-table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th>°C</th>
                <th>мин</th>
                <th>макс</th>
                <th>мм</th>
              </tr>
            </thead>
            <tbody>
              {selected.months.map((month) => (
                <tr key={month.month}>
                  <td>{monthLabel(month.month)}</td>
                  <td>{month.tAvg ?? '—'}</td>
                  <td>{month.tMin ?? '—'}</td>
                  <td>{month.tMax ?? '—'}</td>
                  <td>{month.precipMm ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {place && stored === null && !loading && !error && <EmptyState>Архив ещё не загружен.</EmptyState>}
    </Screen>
  )
}
