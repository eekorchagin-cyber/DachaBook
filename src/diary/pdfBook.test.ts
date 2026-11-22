import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decompressSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pdfFromJpegs, renderTextBookPdf, type PdfBook, type PdfFonts } from './pdfBook'

/** Минимальный JPEG 1×1, чтобы проверить сборку файла без холста. */
const PIXEL = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z'), (char) => char.charCodeAt(0))

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), '../assets/fonts')
const fonts: PdfFonts = {
  regular: new Uint8Array(readFileSync(join(fontsDir, 'DejaVuSans.ttf'))),
  bold: new Uint8Array(readFileSync(join(fontsDir, 'DejaVuSans-Bold.ttf'))),
}

const sampleBook: PdfBook = {
  author: 'Иван Садовод',
  place: 'Участок «Берёзка»',
  range: '2024',
  printedAt: '01.05.2024',
  chapters: [
    {
      title: '2024',
      months: [
        {
          title: 'Май',
          events: [
            {
              dateLabel: '12.05.2024',
              typeLabel: 'Работа',
              where: 'Грядки',
              workKind: 'Посадка помидоров',
              comment: 'Высадили рассаду в открытый грунт. Полили тёплой водой.',
              extras: ['Облачно, +18°'],
              photos: [],
            },
          ],
        },
      ],
    },
  ],
}

/** Распаковывает Flate-потоки PDF (байты, не через UTF-8). */
function inflateStreams(bytes: Uint8Array): string {
  const latin = new TextDecoder('latin1').decode(bytes)
  const out: string[] = [latin]
  let from = 0
  while (from < latin.length) {
    const head = latin.indexOf('stream', from)
    if (head < 0) break
    // не путать с endstream / ObjStm: нужен перевод строки сразу после stream
    const after = head + 'stream'.length
    if (latin[after] !== '\n' && !(latin[after] === '\r' && latin[after + 1] === '\n')) {
      from = after
      continue
    }
    let start = after + (latin[after] === '\r' ? 2 : 1)
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    let stop = end
    if (latin[stop - 1] === '\n') stop -= 1
    if (latin[stop - 1] === '\r') stop -= 1
    try {
      out.push(new TextDecoder('latin1').decode(decompressSync(bytes.subarray(start, stop))))
    } catch {
      /* бинарный шрифт и т.п. */
    }
    from = end + 'endstream'.length
  }
  return out.join('\n')
}

describe('PDF дневника', () => {
  it('собирает файл с заголовком PDF и двумя страницами', async () => {
    const blob = pdfFromJpegs([
      { bytes: PIXEL, width: 1, height: 1 },
      { bytes: PIXEL, width: 1, height: 1 },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('%%EOF')
    expect(blob.type).toBe('application/pdf')
  })

  it('текстовый PDF содержит копируемую кириллицу и встроенный шрифт', async () => {
    const blob = await renderTextBookPdf(sampleBook, fonts)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const plain = new TextDecoder('latin1').decode(bytes)
    expect(plain.startsWith('%PDF-1')).toBe(true)
    expect(blob.type).toBe('application/pdf')
    expect(plain).toContain('/Font')
    expect(plain).toContain('DejaVuSans')

    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)

    const inflated = inflateStreams(bytes)
    expect(inflated).toContain('ToUnicode')
    expect(inflated).toContain('beginbfchar')
    // U+041F «П» из «Посадка» / «помидоров» в ToUnicode CMap
    expect(inflated).toMatch(/<041[Ff]>/)
  })
})
