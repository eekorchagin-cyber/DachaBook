import { MONTHS_SHORT } from '../domain/labels'
import type { DiaryEvent, WateringKind, WateringZone } from '../domain/types'
import { addDays, dateText } from '../plan/frost'

export type WateringState = 'ready' | 'done' | 'rain' | 'skipped' | 'soon' | 'planned' | 'off'

export const WATERING_STATES: Record<WateringState, string> = {
  ready: 'пора поливать',
  done: 'полито сегодня',
  rain: 'дождь — можно не поливать',
  skipped: 'пропущено сегодня',
  soon: 'скоро',
  planned: 'по расписанию',
  off: 'вне сезона',
}

export const WATERING_KINDS: Record<WateringKind, string> = {
  sprinkler: 'дождевание',
  drip: 'капля',
  hose: 'шланг',
  other: 'другое',
}

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const SOON_DAYS = 14

export interface WateringStatus {
  state: WateringState
  message?: string
  date?: string
  rainMm?: number
}

export interface WateringContext {
  today: string
  /** Осадки по датам, мм (прогноз и недавние сутки из Open-Meteo). */
  precipitation: Record<string, number>
}

function isoWeekday(date: string): number {
  const js = new Date(`${date}T12:00:00Z`).getUTCDay()
  return js === 0 ? 7 : js
}

function calendarDate(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const safe = Math.min(Math.max(day, 1), last)
  return `${year}-${String(month).padStart(2, '0')}-${String(safe).padStart(2, '0')}`
}

function crossesYear(zone: WateringZone): boolean {
  return zone.toMonth * 40 + zone.toDay < zone.fromMonth * 40 + zone.fromDay
}

export function wateringWindow(zone: WateringZone, startYear: number): { start: string; end: string } {
  const start = calendarDate(startYear, zone.fromMonth, zone.fromDay)
  const end = calendarDate(crossesYear(zone) ? startYear + 1 : startYear, zone.toMonth, zone.toDay)
  return { start, end }
}

export function wateringStartYear(zone: WateringZone, today: string): number {
  const year = Number(today.slice(0, 4))
  if (!crossesYear(zone)) return year
  const previous = wateringWindow(zone, year - 1)
  return today >= previous.start && today <= previous.end ? year - 1 : year
}

export function inWateringSeason(zone: WateringZone, today: string): boolean {
  const { start, end } = wateringWindow(zone, wateringStartYear(zone, today))
  return today >= start && today <= end
}

export function nextWateringDay(zone: WateringZone, today: string): string | undefined {
  const days = [...new Set(zone.weekdays)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
  if (!days.length) return undefined
  const year = wateringStartYear(zone, today)
  const { start, end } = wateringWindow(zone, year)
  const from = today < start ? start : today
  for (let date = from; date <= end; date = addDays(date, 1)) {
    if (days.includes(isoWeekday(date))) return date
  }
  if (crossesYear(zone)) return undefined
  const next = wateringWindow(zone, year + 1)
  for (let date = next.start; date <= next.end; date = addDays(date, 1)) {
    if (days.includes(isoWeekday(date))) return date
  }
  return undefined
}

export function rainMm(context: WateringContext): number {
  const yesterday = addDays(context.today, -1)
  return (context.precipitation[yesterday] ?? 0) + (context.precipitation[context.today] ?? 0)
}

/** Записи полива этой зоны: вид работы «Полив» на её объектах или комментарий «Полив: название». */
export function wateringHistory(zone: WateringZone, events: DiaryEvent[]): string[] {
  const dates = events
    .filter((event) => !event.deletedAt && event.type === 'work')
    .filter((event) => {
      if (event.comment.trim() === `Полив: ${zone.name}` || event.comment.startsWith(`Полив: ${zone.name}.`) || event.comment.startsWith(`Полив: ${zone.name}\n`)) {
        return true
      }
      if (event.workKind !== 'Полив') return false
      return zone.objectIds.length > 0 && event.objectIds.some((id) => zone.objectIds.includes(id))
    })
    .map((event) => event.date)
  return [...new Set(dates)].sort().reverse()
}

export function wateringStatus(zone: WateringZone, history: string[], context: WateringContext): WateringStatus {
  const { today } = context
  if (zone.skippedDates?.includes(today)) return { state: 'skipped', date: today, message: 'сегодня пропущено' }
  if (history[0] === today) return { state: 'done', date: today, message: 'есть запись в дневнике' }
  const next = nextWateringDay(zone, today)
  const inSeason = inWateringSeason(zone, today)
  const rain = rainMm(context)
  const wet = rain >= zone.skipRainMm
  if (inSeason && zone.weekdays.includes(isoWeekday(today))) {
    if (wet) {
      return {
        state: 'rain',
        date: today,
        rainMm: rain,
        message: `осадки ${formatMm(rain)} (порог ${formatMm(zone.skipRainMm)})`,
      }
    }
    return { state: 'ready', date: today, message: durationText(zone) }
  }
  if (!inSeason) {
    if (next && next <= addDays(today, SOON_DAYS)) return { state: 'soon', date: next, message: `сезон с ${dateText(next)}` }
    return { state: 'off', date: next, message: next ? `сезон с ${dateText(next)}` : 'задайте окно сезона' }
  }
  if (!next) return { state: 'planned', message: 'не выбран день недели' }
  if (wet && next <= addDays(today, 1)) {
    return { state: 'rain', date: next, rainMm: rain, message: `осадки ${formatMm(rain)}, следующий ${dateText(next)}` }
  }
  if (next <= addDays(today, SOON_DAYS)) return { state: 'soon', date: next, message: `следующий ${dateText(next)}${durationText(zone) ? ` · ${durationText(zone)}` : ''}` }
  return { state: 'planned', date: next, message: `следующий ${dateText(next)}` }
}

export function isWateringUpcoming(status: WateringStatus): boolean {
  return status.state === 'ready' || status.state === 'rain' || status.state === 'soon'
}

export function zoneScheduleText(zone: WateringZone): string {
  const days = [...zone.weekdays].sort((a, b) => a - b).map((day) => WEEKDAYS_SHORT[day - 1])
  const rhythm = days.length ? days.join(', ') : 'дни не выбраны'
  const span = `с ${zone.fromDay} ${MONTHS_SHORT[zone.fromMonth - 1]} по ${zone.toDay} ${MONTHS_SHORT[zone.toMonth - 1]}${crossesYear(zone) ? ' следующего года' : ''}`
  const time = zone.timeFrom ? `, ${zone.timeFrom}` : ''
  const duration = zone.durationMin ? `, ${zone.durationMin} мин` : ''
  return `${rhythm}${time}${duration}, ${span}`
}

function durationText(zone: WateringZone): string {
  return zone.durationMin ? `${zone.durationMin} мин` : ''
}

function formatMm(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мм`
}

export { WEEKDAYS_SHORT }
