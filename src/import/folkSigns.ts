import { MONTHS_GENITIVE as MONTHS } from '../domain/dates'
import type { DocInput, FolkSign } from '../domain/types'

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const stripMarkdown = (text: string) => text.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim()

/** «7 января» → { month: 1, day: 7 }. */
export function parseDayMonth(text: string): { month: number; day: number } | null {
  const match = stripMarkdown(text).toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)$/)
  if (!match) return null
  const month = MONTHS.indexOf(match[2]) + 1
  const day = Number(match[1])
  if (month === 0 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null
  return { month, day }
}

/**
 * Свод примет в Markdown: таблица «| Дата | Описание приметы |» и список источников «1. [Название](ссылка)».
 * Номер источника «[1]» в конце строки относится ко всем строкам выше него до предыдущего номера.
 */
export function parseFolkSigns(markdown: string): DocInput<FolkSign>[] {
  const sources = new Map<string, { title: string; url?: string }>()
  for (const line of markdown.split('\n')) {
    const source = line.match(/^\s*(\d+)\.\s+\[([^\]]+)\]\(([^)\s]+)\)/)
    if (source) sources.set(source[1], { title: source[2].trim(), url: source[3] })
  }

  const signs: DocInput<FolkSign>[] = []
  let pending: DocInput<FolkSign>[] = []
  for (const line of markdown.split('\n')) {
    const cells = line.trim().match(/^\|(.+)\|$/)?.[1].split('|')
    if (!cells || cells.length < 2) continue
    const date = parseDayMonth(cells[0])
    if (!date) continue
    let description = cells.slice(1).join('|').trim()
    const marker = description.match(/\s*\[(\d+)\]\s*$/)
    if (marker) description = description.slice(0, marker.index).trim()
    const titled = description.match(/^\*\*(.+?)\*\*\s*(.*)$/)
    const title = stripMarkdown(titled ? titled[1] : '').replace(/\.$/, '')
    const sign: DocInput<FolkSign> = { ...date, title, text: stripMarkdown(titled ? titled[2] : description) }
    signs.push(sign)
    pending.push(sign)
    if (marker) {
      const source = sources.get(marker[1])
      if (source) for (const item of pending) item.source = source
      pending = []
    }
  }
  return signs
}

/** Ключ для поиска дублей: одна примета на один день с тем же названием. */
export function folkSignKey(sign: Pick<FolkSign, 'month' | 'day' | 'title' | 'text'>): string {
  return `${sign.month}-${sign.day}-${(sign.title || sign.text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`
}

export function folkSignDate(sign: Pick<FolkSign, 'month' | 'day'>): string {
  return `${sign.day} ${MONTHS[sign.month - 1]}`
}

/** Порядок в году с учётом 29 февраля: для сортировки и поиска ближайшей приметы. */
export function dayOfYear(month: number, day: number): number {
  return DAYS_IN_MONTH.slice(0, month - 1).reduce((sum, days) => sum + days, 0) + day
}

/** Приметы на сегодня, а если их нет — ближайшие в пределах недели вперёд. */
export function upcomingSigns<T extends Pick<FolkSign, 'month' | 'day'>>(signs: T[], today: { month: number; day: number }, days = 7): { signs: T[]; ahead: number } {
  const now = dayOfYear(today.month, today.day)
  for (let ahead = 0; ahead <= days; ahead++) {
    const target = ((now - 1 + ahead) % 366) + 1
    const found = signs.filter((sign) => dayOfYear(sign.month, sign.day) === target)
    if (found.length > 0) return { signs: found, ahead }
  }
  return { signs: [], ahead: 0 }
}
