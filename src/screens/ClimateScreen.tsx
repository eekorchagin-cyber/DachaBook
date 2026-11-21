import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { getSetting } from '../app/store'
import type { YearClimate } from '../domain/monthlyClimate'
import { averageClimate, monthLabel } from '../domain/monthlyClimate'
import { errorText } from '../lib/format'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { MONTHLY_CLIMATE_YEARS, readMonthlyClimate, refreshMonthlyClimate, type StoredMonthlyClimate } from '../weather/monthlyClimate'
import { useForecast } from '../weather/service'

/** Столбцы осадков и линия средней температуры по месяцам; пунктир — 0 °C. */
function ClimateChart({ year, title }: { year: YearClimate; title: string }) {
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
  const zeroY = yTemp(0)
  const points = year.months
    .map((month, index) => (month.tAvg === null ? null : `${x(index)},${yTemp(month.tAvg)}`))
    .filter(Boolean)
    .join(' ')

  return (
    <svg className="climate-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} className="climate-zero" />
      <text className="climate-zero-label" x={width - pad.right + 4} y={zeroY + 3}>
        0°
      </text>
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

type YearChoice = number | 'all'

/** Пять лет температуры и осадков по месяцам; «Все годы» — средние за период. */
export function ClimateScreen() {
  const { location } = useForecast()
  const plot = useLiveQuery(() => getSetting('plotLocation'), [])
  const place = location ?? plot ?? null
  const [stored, setStored] = useState<StoredMonthlyClimate | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const years = stored?.years ?? []
  const [choice, setChoice] = useState<YearChoice | null>(null)
  const average = useMemo(() => (years.length ? averageClimate(years) : null), [years])
  const selected = useMemo(() => {
    if (choice === 'all') return average
    if (typeof choice === 'number') return years.find((item) => item.year === choice) ?? years.at(-1) ?? null
    return years.at(-1) ?? null
  }, [average, choice, years])
  const selectedTitle = choice === 'all' || selected?.year === 0 ? 'Все годы' : String(selected?.year ?? '')

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
    if (!years.length) return
    if (choice === 'all') return
    if (choice === null || !years.some((item) => item.year === choice)) setChoice(years.at(-1)!.year)
  }, [years, choice])

  const load = async () => {
    setError('')
    setLoading(true)
    try {
      const next = await refreshMonthlyClimate()
      setStored(next)
      if (next?.years.length) setChoice(next.years.at(-1)!.year)
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
    <Screen title="Климат участка" help="climate" back="/more" tab="/more">
      <p className="hint">
        Средняя температура и сумма осадков по месяцам за {MONTHLY_CLIMATE_YEARS} полных лет. «Все годы» — средние за весь период. Данные Open-Meteo для координат
        участка — модельная оценка, не измерение на грядке.
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
          <button type="button" className={choice === 'all' ? 'chip active' : 'chip'} onClick={() => setChoice('all')}>
            Все годы
          </button>
          {years.map((item) => (
            <button key={item.year} type="button" className={choice === item.year ? 'chip active' : 'chip'} onClick={() => setChoice(item.year)}>
              {item.year}
            </button>
          ))}
        </div>
      )}
      {selected && <ClimateChart year={selected} title={`Климат: ${selectedTitle}`} />}
      {selected && (
        <ul className="climate-legend">
          <li>
            <span className="climate-swatch temp" /> средняя температура, °C
          </li>
          <li>
            <span className="climate-swatch precip" /> осадки за месяц, мм
          </li>
          <li>
            <span className="climate-swatch zero" /> отметка 0 °C
          </li>
        </ul>
      )}
      {selected && (
        <details className="card">
          <summary>
            <strong>Цифры: {selectedTitle}</strong>
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
