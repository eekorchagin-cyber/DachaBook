import { useMemo, useState } from 'react'
import { navigate } from '../app/router'
import type { DiaryEvent } from '../domain/types'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const pad = (value: number) => String(value).padStart(2, '0')
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Недели месяца блоками по 7 дней: 1–7, 8–14, 15–21, 22–28, 29–конец. */
function weeks(year: number, month: number): { from: string; to: string; label: string }[] {
  const last = lastDay(year, month)
  const blocks: { from: string; to: string; label: string }[] = []
  for (let start = 1; start <= last; start += 7) {
    const end = Math.min(start + 6, last)
    blocks.push({ from: `${year}-${pad(month)}-${pad(start)}`, to: `${year}-${pad(month)}-${pad(end)}`, label: start === end ? String(start) : `${start}–${end}` })
  }
  return blocks
}

const go = (from: string, to: string) => navigate(`/diary?from=${from}&to=${to}`)

/** Быстрый переход к записям за год, месяц, неделю или конкретный день; пустые периоды недоступны. */
export function DateJump({ events }: { events: DiaryEvent[] }) {
  const dates = useMemo(() => events.filter((event) => !event.deletedAt).map((event) => event.date), [events])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const date of dates) for (const key of [date.slice(0, 4), date.slice(0, 7)]) map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, [dates])
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))].sort().reverse()
  const [year, setYear] = useState<string | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [day, setDay] = useState('')
  if (years.length === 0) return null
  const inRange = (from: string, to: string) => dates.filter((date) => date >= from && date <= to).length

  return (
    <section className="card date-jump">
      <h2>Перейти к дате</h2>
      <div className="jump-row" role="group" aria-label="Год">
        {years.map((item) => (
          <button
            key={item}
            type="button"
            className={item === year ? 'chip active' : 'chip'}
            onClick={() => {
              setYear(item === year ? null : item)
              setMonth(null)
            }}
          >
            {item} <span className="jump-count">{counts.get(item)}</span>
          </button>
        ))}
      </div>
      {year && (
        <div className="jump-row" role="group" aria-label="Месяц">
          {MONTHS.map((name, index) => {
            const count = counts.get(`${year}-${pad(index + 1)}`) ?? 0
            return (
              <button
                key={name}
                type="button"
                className={index + 1 === month ? 'chip active' : 'chip'}
                disabled={count === 0}
                onClick={() => setMonth(index + 1 === month ? null : index + 1)}
              >
                {name}
              </button>
            )
          })}
          <button type="button" className="chip jump-all" onClick={() => go(`${year}-01-01`, `${year}-12-31`)}>
            весь {year} →
          </button>
        </div>
      )}
      {year && month && (
        <div className="jump-row" role="group" aria-label="Неделя">
          {weeks(Number(year), month).map((week) => (
            <button key={week.from} type="button" className="chip" disabled={inRange(week.from, week.to) === 0} onClick={() => go(week.from, week.to)}>
              {week.label}
            </button>
          ))}
          <button type="button" className="chip jump-all" onClick={() => go(`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(lastDay(Number(year), month))}`)}>
            весь {MONTHS[month - 1]} →
          </button>
        </div>
      )}
      <label className="field jump-date">
        Или конкретная дата
        <span className="jump-date-row">
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          <button type="button" className="button secondary" disabled={!day} onClick={() => go(day, day)}>
            Показать
          </button>
        </span>
      </label>
    </section>
  )
}
