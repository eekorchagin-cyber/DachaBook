/** Разбор заметки-таблицы дневника Evernote (раздел 3 ТЗ, «Заметки-таблицы дневника»). */

export type Checkbox = 'checked' | 'unchecked' | 'none'

export interface DiaryRow {
  month: number
  week?: string
  checkbox: Checkbox
  text: string
  rawDate: string
  mediaHashes: string[]
  /** Порядковый номер строки в заметке: отличает одинаковые строки внутри одной таблицы. */
  index: number
}

export interface OutsideText {
  /** Месяц таблицы, после которой стоит текст; 0 — до первой таблицы. */
  month: number
  text: string
  mediaHashes: string[]
  /** Номер последней строки предыдущей таблицы — «запись выше», к которой фрагмент можно прикрепить. */
  afterRowIndex?: number
}

export interface DiaryTable {
  rows: DiaryRow[]
  outside: OutsideText[]
}

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
const MONTH_WORD = /^(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)$/i
const HEADER = 'работы, наблюдения'

function monthFromWord(word: string): number | undefined {
  const lower = word.toLowerCase()
  const index = MONTHS.findIndex((stem, i) => (i === 4 ? lower === 'май' || lower === 'мая' : lower.startsWith(stem)))
  return index >= 0 ? index + 1 : undefined
}

/** Текст ячейки: абзацы сохраняются, ссылки с другим текстом получают адрес в скобках. */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element
  clone.querySelectorAll('en-media, en-todo').forEach((node) => node.remove())
  clone.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? ''
    if (href && link.textContent?.trim() !== href) link.append(` (${href})`)
  })
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  clone.querySelectorAll('div, p, li').forEach((block) => block.append('\n'))
  return (clone.textContent ?? '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function mediaHashes(node: Element): string[] {
  return Array.from(node.querySelectorAll('en-media'))
    .map((media) => media.getAttribute('hash')?.toLowerCase() ?? '')
    .filter(Boolean)
}

function directCells(row: Element): Element[] {
  return Array.from(row.children).filter((child) => child.tagName.toLowerCase() === 'td' || child.tagName.toLowerCase() === 'th')
}

function hasHeader(table: Element): boolean {
  return Array.from(table.querySelectorAll('tr')).some((row) => {
    const cells = directCells(row)
    return cells.length === 4 && cellText(cells[2]).toLowerCase() === HEADER
  })
}

/** У отдельных месяцев строки-заголовка нет (в образце — октябрь), поэтому таблица месяца — любая с четырьмя колонками. */
function isDiaryTable(table: Element): boolean {
  return Array.from(table.querySelectorAll('tr')).some((row) => directCells(row).length === 4)
}

/**
 * ENML — XHTML: <en-media .../> и <en-todo .../> самозакрывающиеся. HTML-разборщик так не считает и «заглатывает»
 * следующий текст внутрь тега, поэтому теги закрываются явно.
 */
export function parseEnml(content: string): Document {
  const html = content
    .replace(/^\s*<\?xml[^>]*>/, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<(en-media|en-todo|en-crypt)\b([^>]*?)\/>/gi, '<$1$2></$1>')
  return new DOMParser().parseFromString(html, 'text/html')
}

const parse = parseEnml

/** Заметка-таблица распознаётся по структуре: таблицы с четырьмя колонками и заголовком «Работы, наблюдения». */
export function isDiaryNote(content: string): boolean {
  return Array.from(parse(content).querySelectorAll('table')).filter(hasHeader).length >= 3
}

export function parseDiaryTable(content: string): DiaryTable {
  const doc = parse(content)
  const tables = Array.from(doc.querySelectorAll('table')).filter(isDiaryTable)
  const rows: DiaryRow[] = []
  const outside: OutsideText[] = []

  const marker = (index: number) => `⟦T${index}⟧`
  const body = doc.body.cloneNode(true) as Element
  const bodyTables = Array.from(body.querySelectorAll('table')).filter(isDiaryTable)
  bodyTables.forEach((table, index) => table.replaceWith(doc.createTextNode(marker(index))))
  body.querySelectorAll('en-media').forEach((media) => media.replaceWith(doc.createTextNode(`⟦M${media.getAttribute('hash')?.toLowerCase() ?? ''}⟧`)))
  body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  body.querySelectorAll('div, p, li').forEach((block) => block.append('\n'))
  const segmentsText = (body.textContent ?? '').split(/⟦T\d+⟧/)

  const months: number[] = tables.map((_, index) => {
    const lines = (segmentsText[index] ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    const named = [...lines].reverse().find((line) => MONTH_WORD.test(line))
    return (named && monthFromWord(named)) || index + 1
  })

  const lastRowOfTable: (number | undefined)[] = []
  let index = 0
  tables.forEach((table, tableIndex) => {
    lastRowOfTable[tableIndex] = undefined
    let week: string | undefined
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const cells = directCells(row)
      if (cells.length !== 4) continue
      const weekText = cellText(cells[0])
      if (/^\d+$/.test(weekText)) week = weekText
      const text = cellText(cells[2])
      if (!text || text.toLowerCase() === HEADER) continue
      const todo = cells[1].querySelector('en-todo')
      rows.push({
        month: months[tableIndex],
        week,
        checkbox: !todo ? 'none' : todo.getAttribute('checked') === 'true' ? 'checked' : 'unchecked',
        text,
        rawDate: cellText(cells[3]).replace(/\n/g, ' '),
        mediaHashes: [...mediaHashes(cells[2]), ...mediaHashes(cells[3])],
        index,
      })
      lastRowOfTable[tableIndex] = index++
    }
  })

  segmentsText.forEach((segment, segmentIndex) => {
    const hashes = [...segment.matchAll(/⟦M([0-9a-f]*)⟧/g)].map((match) => match[1]).filter(Boolean)
    const text = segment
      .replace(/⟦M[0-9a-f]*⟧/g, '')
      .split('\n')
      .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
      .filter((line) => line && !MONTH_WORD.test(line))
      .join('\n')
    if (!text && hashes.length === 0) return
    outside.push({
      month: segmentIndex === 0 ? 0 : months[segmentIndex - 1],
      text,
      mediaHashes: hashes,
      afterRowIndex: segmentIndex === 0 ? undefined : lastRowOfTable[segmentIndex - 1],
    })
  })
  return { rows, outside }
}

const MONTH_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export interface ParsedDate {
  status: 'ok' | 'needs-confirmation' | 'none'
  /** Точная дата ГГГГ-ММ-ДД для status = ok. */
  date?: string
  /** Предлагаемая дата для нестандартного написания. */
  suggestion?: string
}

function iso(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function fullYear(value: string): number {
  return value.length === 2 ? 2000 + Number(value) : Number(value)
}

/** Дата из колонки «Дата выполнения»: ДД.ММ.ГГГГ и ДД.ММ.ГГ — точные, остальное — на подтверждение. */
export function parseRawDate(raw: string, season: number): ParsedDate {
  const value = raw.trim()
  if (!value) return { status: 'none' }
  const exact = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/)
  if (exact) {
    const date = iso(fullYear(exact[3]), Number(exact[2]), Number(exact[1]))
    if (date) return { status: 'ok', date }
  }
  const range = value.match(/(\d{1,2})\s*[-–]\s*\d{1,2}\.(\d{1,2})\.(\d{4}|\d{2})/)
  if (range) return { status: 'needs-confirmation', suggestion: iso(fullYear(range[3]), Number(range[2]), Number(range[1])) }
  const first = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})/)
  if (first) return { status: 'needs-confirmation', suggestion: iso(fullYear(first[3]), Number(first[2]), Number(first[1])) }
  const words = value.toLowerCase().match(/(\d{1,2})\s+([а-я]+)\s+(\d{4})/)
  if (words && MONTH_GENITIVE.includes(words[2])) {
    return { status: 'needs-confirmation', suggestion: iso(Number(words[3]), MONTH_GENITIVE.indexOf(words[2]) + 1, Number(words[1])) }
  }
  const noYear = value.match(/^(\d{1,2})\.(\d{1,2})\.?$/)
  if (noYear) return { status: 'needs-confirmation', suggestion: iso(season, Number(noYear[2]), Number(noYear[1])) }
  return { status: 'needs-confirmation' }
}
