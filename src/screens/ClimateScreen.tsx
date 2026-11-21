import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSetting } from '../app/store'
import { climateMonthIcon, type ClimateMonthIcon } from '../domain/climateIcons'
import type { MonthClimate, YearClimate } from '../domain/monthlyClimate'
import { averageClimate, monthLabel } from '../domain/monthlyClimate'
import type { PlotLocation } from '../domain/location'
import { errorText } from '../lib/format'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { MONTHLY_CLIMATE_YEARS, readMonthlyClimate, refreshMonthlyClimate, type StoredMonthlyClimate } from '../weather/monthlyClimate'
import { fetchArchive } from '../weather/openMeteo'
import { useForecast } from '../weather/service'

function monthRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0')
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

function IconSnow({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 5} ${y - 5})`} className="climate-icon snow" aria-hidden="true">
      <line x1="5" y1="0" x2="5" y2="10" />
      <line x1="0" y1="5" x2="10" y2="5" />
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
    </g>
  )
}

function IconRain({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 4} ${y - 5})`} className="climate-icon rain" aria-hidden="true">
      <path d="M4 0 C6.5 0 8 2 8 4 C8 7 4 10 4 10 C4 10 0 7 0 4 C0 2 1.5 0 4 0 Z" />
    </g>
  )
}

function MonthIcons({ icon, x, y }: { icon: ClimateMonthIcon; x: number; y: number }) {
  if (icon === 'none') return null
  if (icon === 'snow') return <IconSnow x={x} y={y} />
  if (icon === 'rain') return <IconRain x={x} y={y} />
  return (
    <g>
      <IconSnow x={x - 7} y={y} />
      <IconRain x={x + 7} y={y} />
    </g>
  )
}

/** Столбцы осадков и линия средней температуры по месяцам; пунктир — 0 °C. Долгий тап по месяцу — суточная детализация. */
function ClimateChart({
  year,
  title,
  onMonth,
}: {
  year: YearClimate
  title: string
  onMonth?: (month: MonthClimate) => void
}) {
  const width = 360
  const height = 220
  const pad = { top: 28, right: 36, bottom: 36, left: 36 }
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
  const hold = useRef<{ id: number; month: MonthClimate } | null>(null)

  const startHold = (month: MonthClimate) => {
    if (!onMonth) return
    clearHold()
    hold.current = {
      id: window.setTimeout(() => {
        hold.current = null
        onMonth(month)
      }, 450),
      month,
    }
  }
  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current.id)
    hold.current = null
  }

  return (
    <svg className="climate-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} className="climate-zero" />
      <text className="climate-zero-label" x={width - pad.right + 4} y={zeroY + 3}>
        0°
      </text>
      {year.months.map((month, index) => {
        const precip = month.precipMm ?? 0
        const barH = (precip / pMax) * innerH * 0.85
        const cx = x(index)
        return (
          <g
            key={month.month}
            className="climate-month-hit"
            onPointerDown={() => startHold(month)}
            onPointerUp={clearHold}
            onPointerLeave={clearHold}
            onPointerCancel={clearHold}
            onClick={() => onMonth?.(month)}
            style={{ cursor: onMonth ? 'pointer' : undefined }}
          >
            <rect x={cx - barW / 2 - 2} y={pad.top} width={barW + 4} height={innerH + 20} fill="transparent" />
            <rect className="climate-precip" x={cx - barW / 2} y={pad.top + innerH - barH} width={barW} height={Math.max(barH, 0)} rx={2} />
            <MonthIcons icon={climateMonthIcon(month)} x={cx} y={14} />
            <text className="climate-label" x={cx} y={height - 10} textAnchor="middle">
              {monthLabel(month.month)}
            </text>
          </g>
        )
      })}
      {points && <polyline className="climate-temp" fill="none" points={points} />}
      {year.months.map((month, index) =>
        month.tAvg === null ? null : <circle key={`t-${month.month}`} className="climate-temp-dot" cx={x(index)} cy={yTemp(month.tAvg)} r={3} />,
      )}
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

function DailyChart({
  days,
  title,
}: {
  days: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[] }
  title: string
}) {
  const n = days.time.length
  if (!n) return <EmptyState>Нет суточных данных за этот месяц.</EmptyState>
  const width = 360
  const height = 200
  const pad = { top: 16, right: 36, bottom: 28, left: 36 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const temps = [...days.temperature_2m_max, ...days.temperature_2m_min].filter((value): value is number => value !== null)
  const precips = days.precipitation_sum.filter((value): value is number => value !== null)
  const tMin = temps.length ? Math.min(...temps, 0) - 2 : -10
  const tMax = temps.length ? Math.max(...temps, 0) + 2 : 20
  const pMax = Math.max(...precips, 1)
  const x = (index: number) => pad.left + ((index + 0.5) / n) * innerW
  const yTemp = (value: number) => pad.top + ((tMax - value) / (tMax - tMin || 1)) * innerH
  const barW = Math.max(innerW / n - 1, 1)
  const avgPoints = days.time
    .map((_, index) => {
      const max = days.temperature_2m_max[index]
      const min = days.temperature_2m_min[index]
      if (max === null || min === null || max === undefined || min === undefined) return null
      return `${x(index)},${yTemp((max + min) / 2)}`
    })
    .filter(Boolean)
    .join(' ')

  return (
    <svg className="climate-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {days.time.map((date, index) => {
        const precip = days.precipitation_sum[index] ?? 0
        const barH = (precip / pMax) * innerH * 0.7
        return <rect key={date} className="climate-precip" x={x(index) - barW / 2} y={pad.top + innerH - barH} width={barW} height={Math.max(barH, 0)} />
      })}
      {avgPoints && <polyline className="climate-temp" fill="none" points={avgPoints} />}
      {[0, Math.floor((n - 1) / 2), n - 1].map((index) => (
        <text key={days.time[index]} className="climate-label" x={x(index)} y={height - 8} textAnchor="middle">
          {days.time[index].slice(8)}
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

/** Пять лет температуры и осадков по месяцам; тап по месяцу — суточный архив. */
export function ClimateScreen() {
  const { location } = useForecast()
  const plot = useLiveQuery(() => getSetting('plotLocation'), [])
  const place = (location ?? plot ?? null) as PlotLocation | null
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
  const [detailMonth, setDetailMonth] = useState<number | null>(null)
  const [daily, setDaily] = useState<{
    time: string[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
    precipitation_sum: (number | null)[]
  } | null>(null)
  const [dailyLoading, setDailyLoading] = useState(false)
  const detailYear = typeof choice === 'number' ? choice : years.at(-1)?.year

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

  const openMonth = async (month: MonthClimate) => {
    if (!place || !detailYear) {
      setError('Нужны координаты участка и выбранный год.')
      return
    }
    setError('')
    setDetailMonth(month.month)
    setDaily(null)
    setDailyLoading(true)
    try {
      const range = monthRange(detailYear, month.month)
      const series = await fetchArchive(place, range.start, range.end, false)
      if (!series.daily) throw new Error('Архив не вернул суточные данные.')
      setDaily({
        time: series.daily.time,
        temperature_2m_max: series.daily.temperature_2m_max,
        temperature_2m_min: series.daily.temperature_2m_min,
        precipitation_sum: series.daily.precipitation_sum,
      })
    } catch (caught) {
      setError(errorText(caught))
      setDetailMonth(null)
    } finally {
      setDailyLoading(false)
    }
  }

  const closeDetail = () => {
    setDetailMonth(null)
    setDaily(null)
  }

  return (
    <Screen title="Климат участка" help="climate" back="/more/plot" tab="/more">
      <p className="hint">
        Средняя температура и сумма осадков по месяцам за {MONTHLY_CLIMATE_YEARS} полных лет. «Все годы» — средние за период. Нажмите или удерживайте столбец месяца —
        суточный график за этот месяц (данные не сохраняются на устройстве). Open-Meteo — модельная оценка, не измерение на грядке.
      </p>
      {!place && (
        <p className="hint">
          Укажите координаты участка: <a href="#/settings?part=plot-location">«Ещё → Участок → Координаты для погоды»</a>.
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
      {detailMonth !== null ? (
        <section>
          <div className="actions">
            <button type="button" className="button secondary" onClick={closeDetail}>
              ← Назад к месяцам
            </button>
          </div>
          <h2>
            {monthLabel(detailMonth)} {detailYear}
          </h2>
          {dailyLoading && <p className="hint">Загружаю сутки…</p>}
          {daily && <DailyChart days={daily} title={`Сутки: ${monthLabel(detailMonth)} ${detailYear}`} />}
          {daily && (
            <ul className="climate-legend">
              <li>
                <span className="climate-swatch temp" /> средняя температура суток, °C
              </li>
              <li>
                <span className="climate-swatch precip" /> осадки за сутки, мм
              </li>
            </ul>
          )}
        </section>
      ) : (
        <>
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
          {selected && <ClimateChart year={selected} title={`Климат: ${selectedTitle}`} onMonth={(month) => void openMonth(month)} />}
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
              <li>снежинка / капля — мороз и заметные осадки у месяца</li>
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
                      <td>
                        <button type="button" className="link" onClick={() => void openMonth(month)}>
                          {monthLabel(month.month)}
                        </button>
                      </td>
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
        </>
      )}
      {place && stored === null && !loading && !error && <EmptyState>Архив ещё не загружен.</EmptyState>}
    </Screen>
  )
}
