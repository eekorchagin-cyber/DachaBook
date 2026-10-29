const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 48
const SCALE = 2

export interface PdfPhoto {
  blob: Blob
  caption?: string
}

export interface PdfEntry {
  dateLabel: string
  typeLabel: string
  where: string
  workKind?: string
  comment: string
  extras: string[]
  photos: PdfPhoto[]
}

export interface PdfChapter {
  title: string
  months: { title: string; events: PdfEntry[] }[]
}

export interface PdfBook {
  author: string
  place?: string
  range: string
  printedAt: string
  chapters: PdfChapter[]
}

const encoder = new TextEncoder()

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function ascii(value: string): Uint8Array {
  return encoder.encode(value)
}

/** Собирает PDF из страниц JPEG (кириллица рисуется на холсте, шрифт в файл встраивать не нужно). */
export function pdfFromJpegs(pages: { bytes: Uint8Array; width: number; height: number }[]): Blob {
  if (pages.length === 0) throw new Error('Нет страниц для PDF')
  const header = ascii('%PDF-1.4\n')
  const chunks: Uint8Array[] = [header]
  const offsets = [0]
  let position = header.length
  const add = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part
    offsets.push(position)
    chunks.push(bytes)
    position += bytes.length
  }

  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const pageRefs = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
  add(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\nendobj\n`)

  pages.forEach((page, index) => {
    const pageObj = 3 + index * 3
    const imageObj = pageObj + 1
    const contentObj = pageObj + 2
    const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im${index + 1} Do Q\n`
    add(`${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im${index + 1} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`)
    add(concat([ascii(`${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`), page.bytes, ascii('\nendstream\nendobj\n')]))
    add(`${contentObj} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  })

  const xrefAt = position
  const xref = [`xref\n0 ${offsets.length}\n0000000000 65535 f \n`]
  for (let index = 1; index < offsets.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  chunks.push(ascii(`${xref.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`))
  const bytes = concat(chunks)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return new Blob([copy], { type: 'application/pdf' })
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = words[0]
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`
      if (context.measureText(next).width <= maxWidth) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

async function jpegOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
  if (!blob) throw new Error('Не удалось собрать страницу PDF')
  return new Uint8Array(await blob.arrayBuffer())
}

async function photoBitmap(blob: Blob): Promise<ImageBitmap | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined
  try {
    return await createImageBitmap(blob)
  } catch {
    return undefined
  }
}

/** Рисует книгу дневника по страницам A4 и собирает PDF-файл. */
export async function renderBookPdf(book: PdfBook): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W * SCALE
  canvas.height = PAGE_H * SCALE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить страницу PDF')
  context.scale(SCALE, SCALE)
  const pages: { bytes: Uint8Array; width: number; height: number }[] = []
  const width = PAGE_W - MARGIN * 2
  let y = 0

  const flush = async () => {
    pages.push({ bytes: await jpegOf(canvas), width: canvas.width, height: canvas.height })
  }
  const fill = () => {
    context.fillStyle = '#f7f4ec'
    context.fillRect(0, 0, PAGE_W, PAGE_H)
    context.fillStyle = '#1c2418'
  }
  const startPage = async () => {
    if (y > 0) await flush()
    fill()
    y = MARGIN
  }
  const need = async (height: number) => {
    if (y + height > PAGE_H - MARGIN) await startPage()
  }
  const paint = (size: number, weight: string, text: string, extra = 0) => {
    context.font = `${weight} ${size}px "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif`
    const lines = wrap(context, text, width)
    return (async () => {
      for (const line of lines) {
        await need(size + 6)
        context.fillText(line, MARGIN, y + size)
        y += size + 4
      }
      y += extra
    })()
  }

  fill()
  y = 220
  context.fillStyle = '#5b6b52'
  context.font = '12px system-ui, sans-serif'
  context.textAlign = 'center'
  context.fillText('DACHABOOK', PAGE_W / 2, y)
  context.textAlign = 'left'
  context.fillStyle = '#1c2418'
  y += 36
  context.font = 'bold 28px "Iowan Old Style", Palatino, serif'
  context.textAlign = 'center'
  context.fillText('Дневник дачи', PAGE_W / 2, y)
  y += 36
  context.font = '16px "Iowan Old Style", Palatino, serif'
  if (book.place) {
    context.fillText(book.place, PAGE_W / 2, y)
    y += 24
  }
  context.fillText(book.author, PAGE_W / 2, y)
  y += 24
  context.fillText(book.range, PAGE_W / 2, y)
  y += 28
  context.fillStyle = '#5b6b52'
  context.font = '12px system-ui, sans-serif'
  context.fillText(`составлено ${book.printedAt}`, PAGE_W / 2, y)
  context.textAlign = 'left'
  y = PAGE_H

  for (const chapter of book.chapters) {
    await startPage()
    context.fillStyle = '#1c2418'
    await paint(22, 'bold', chapter.title, 10)
    for (const month of chapter.months) {
      context.fillStyle = '#1c2418'
      await paint(16, 'bold', month.title, 8)
      for (const event of month.events) {
        const head = [event.dateLabel, event.typeLabel, event.where].filter(Boolean).join(' · ')
        await paint(12, 'bold', head, 2)
        if (event.workKind) await paint(11, 'normal', event.workKind, 2)
        if (event.comment) await paint(12, 'normal', event.comment, 2)
        for (const extra of event.extras) {
          context.fillStyle = '#5b6b52'
          await paint(10, 'normal', extra, 1)
          context.fillStyle = '#1c2418'
        }
        for (const photo of event.photos) {
          const image = await photoBitmap(photo.blob)
          if (!image) continue
          const maxH = 160
          const scale = Math.min(width / image.width, maxH / image.height, 1)
          const drawW = image.width * scale
          const drawH = image.height * scale
          await need(drawH + 18)
          context.drawImage(image, MARGIN, y, drawW, drawH)
          image.close()
          y += drawH + 4
          if (photo.caption) await paint(10, 'normal', photo.caption, 4)
          else y += 8
        }
        y += 10
        context.strokeStyle = '#d5d0c4'
        context.beginPath()
        context.moveTo(MARGIN, y)
        context.lineTo(PAGE_W - MARGIN, y)
        context.stroke()
        y += 12
      }
    }
  }
  await flush()
  return pdfFromJpegs(pages)
}

/** На iPhone — «Поделиться» (в Файлы), иначе скачивание. Печать в установленном приложении на iPhone не открывается. */
export async function sharePdf(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Сохранение отменено')
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
