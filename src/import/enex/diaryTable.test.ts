// @vitest-environment happy-dom
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { isDiaryNote, parseDiaryTable, parseRawDate } from './diaryTable'
import { parseEnexStream, type EnexNote } from './parser'

const row = (week: string, todo: string, text: string, date: string) =>
  `<tr><td><div>${week}</div></td><td><div>${todo}</div></td><td><div>${text}</div></td><td><div>${date}</div></td></tr>`
const header = row('Недели', '', 'Работы, наблюдения', 'Дата выполнения')
const table = (rows: string[]) => `<table><tbody>${header}${rows.join('')}</tbody></table>`

const CONTENT = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "x"><en-note>
<div>Январь</div>${table([row('1', '<en-todo checked="false"/>', 'Уборка снега', '')])}
<div>Февраль</div>${table([row('2', '', 'Снег просел', '25.02.')])}
<div>Март</div>${table([
  row('1', '<en-todo checked="true"/>', 'Обрезал калину', '10.05.2022'),
  row('', '', 'Газон в снегу<br/>высота 30 см', '14.04.21'),
  row('3', '<en-todo/>', '<a href="https://iplants.ru/actara.htm">актарой</a> пролить <en-media hash="ABCDEF0123456789ABCDEF0123456789" type="image/jpeg"/>', ''),
])}
<div>https://ogorod.ru/статья</div>
</en-note>`

describe('parseDiaryTable', () => {
  it('распознаёт заметку-таблицу по структуре', () => {
    expect(isDiaryNote(CONTENT)).toBe(true)
    expect(isDiaryNote('<en-note><table><tr><td>Просто таблица</td></tr></table></en-note>')).toBe(false)
  })

  it('берёт месяц из таблицы, неделю из колонки «Недели» до следующего номера, флажок и дату', () => {
    const { rows } = parseDiaryTable(CONTENT)
    expect(rows.map((item) => [item.month, item.week, item.checkbox, item.rawDate])).toEqual([
      [1, '1', 'unchecked', ''],
      [2, '2', 'none', '25.02.'],
      [3, '1', 'checked', '10.05.2022'],
      [3, '1', 'none', '14.04.21'],
      [3, '3', 'unchecked', ''],
    ])
    expect(rows[3].text).toBe('Газон в снегу\nвысота 30 см')
    expect(rows[4].text).toBe('актарой (https://iplants.ru/actara.htm) пролить')
    expect(rows[4].mediaHashes).toEqual(['abcdef0123456789abcdef0123456789'])
  })

  it('сохраняет текст вне таблиц с месяцем, рядом с которым он стоял', () => {
    const { outside } = parseDiaryTable(CONTENT)
    expect(outside).toEqual([{ month: 3, text: 'https://ogorod.ru/статья', mediaHashes: [] }])
  })
})

describe('parseRawDate', () => {
  it('точные даты', () => {
    expect(parseRawDate('10.05.2022', 2025)).toEqual({ status: 'ok', date: '2022-05-10' })
    expect(parseRawDate('31.08.19', 2025)).toEqual({ status: 'ok', date: '2019-08-31' })
    expect(parseRawDate('', 2025)).toEqual({ status: 'none' })
  })

  it('нестандартные даты требуют подтверждения и получают предложение', () => {
    expect(parseRawDate('3-4.09.2022', 2025)).toEqual({ status: 'needs-confirmation', suggestion: '2022-09-03' })
    expect(parseRawDate('30 октября 2022', 2025)).toEqual({ status: 'needs-confirmation', suggestion: '2022-10-30' })
    expect(parseRawDate('2.11.2019 3.11.2019', 2025)).toEqual({ status: 'needs-confirmation', suggestion: '2019-11-02' })
    expect(parseRawDate('25.02.', 2025)).toEqual({ status: 'needs-confirmation', suggestion: '2025-02-25' })
    expect(parseRawDate('2024', 2025)).toEqual({ status: 'needs-confirmation' })
    expect(parseRawDate('31.02.2024', 2025).status).toBe('needs-confirmation')
  })
})

const samplesDir = join(import.meta.dirname, '../../../DOCS/samples')
const diaryFiles = existsSync(samplesDir) ? readdirSync(samplesDir).filter((file) => file.includes('Дневник дачных работ')) : []

async function readNotes(file: string): Promise<EnexNote[]> {
  const notes: EnexNote[] = []
  const stream = Readable.toWeb(createReadStream(join(samplesDir, file))) as ReadableStream<Uint8Array>
  for await (const note of parseEnexStream(stream)) notes.push(note)
  return notes
}

describe.skipIf(diaryFiles.length === 0)('дневники заказчика (только локально)', () => {
  it('2025: 201 строка — 129 с точной датой, 6 на подтверждение, 66 без даты; флажки 39 / 96 / 66', async () => {
    const [note] = await readNotes('Дневник дачных работ 2025 г.enex')
    expect(isDiaryNote(note.content)).toBe(true)
    const { rows } = parseDiaryTable(note.content)
    const dates = rows.map((item) => parseRawDate(item.rawDate, 2025).status)
    expect(rows).toHaveLength(201)
    expect(dates.filter((status) => status === 'ok')).toHaveLength(129)
    expect(dates.filter((status) => status === 'needs-confirmation')).toHaveLength(6)
    expect(dates.filter((status) => status === 'none')).toHaveLength(66)
    expect(rows.filter((item) => item.checkbox === 'checked')).toHaveLength(39)
    expect(rows.filter((item) => item.checkbox === 'unchecked')).toHaveLength(96)
    expect(rows.filter((item) => item.checkbox === 'none')).toHaveLength(66)
    expect(new Set(rows.map((item) => item.month))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    const withMedia = rows.filter((item) => item.mediaHashes.length > 0)
    expect(withMedia.map((item) => item.rawDate)).toEqual(['24.05.2025'])
  }, 60_000)

  it('все дневники распознаются как таблицы и разбираются', async () => {
    for (const file of diaryFiles) {
      const [note] = await readNotes(file)
      expect(isDiaryNote(note.content), file).toBe(true)
      expect(parseDiaryTable(note.content).rows.length, file).toBeGreaterThan(150)
    }
  }, 120_000)
})
