import { inflateSync, strFromU8 } from 'fflate'
import type { DayOneRawEntry } from './journal'

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export interface DayOnePackage {
  journalName: string
  entries: DayOneRawEntry[]
  /** md5 содержимого → файл в архиве (photos, videos, audios, pdfs). */
  files: Map<string, ZipEntry>
}

const ZIP64 = 0xffffffff

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function u64(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) + u32(bytes, offset + 4) * 0x100000000
}

async function readRange(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  const data = await blob.slice(start, start + length).arrayBuffer()
  return new Uint8Array(data)
}

/** Размеры из дополнительной записи Zip64, если в обычных полях стоит 0xFFFFFFFF. */
function applyZip64(extra: Uint8Array, compressed: number, uncompressed: number, offset: number): { compressed: number; uncompressed: number; offset: number } {
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const id = u16(extra, cursor)
    const length = u16(extra, cursor + 2)
    const data = extra.subarray(cursor + 4, cursor + 4 + length)
    cursor += 4 + length
    if (id !== 1) continue
    let at = 0
    if (uncompressed === ZIP64) {
      uncompressed = u64(data, at)
      at += 8
    }
    if (compressed === ZIP64) {
      compressed = u64(data, at)
      at += 8
    }
    if (offset === ZIP64) offset = u64(data, at)
    break
  }
  return { compressed, uncompressed, offset }
}

function findEocd(tail: Uint8Array): number {
  for (let index = tail.length - 22; index >= 0; index--) {
    if (u32(tail, index) === 0x06054b50) return index
  }
  return -1
}

/** Оглавление ZIP, включая размеры Zip64. Весь архив в память не читается. */
export async function listZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const tailLength = Math.min(blob.size, 64 * 1024 + 22)
  const tail = await readRange(blob, blob.size - tailLength, tailLength)
  const eocd = findEocd(tail)
  if (eocd < 0) throw new Error('Файл не похож на ZIP-архив')
  const count = u16(tail, eocd + 10)
  let cdSize = u32(tail, eocd + 12)
  let cdOffset = u32(tail, eocd + 16)
  if (cdSize === ZIP64 || cdOffset === ZIP64) throw new Error('Архив слишком большой: оглавление Zip64 не прочитано')
  const directory = await readRange(blob, cdOffset, cdSize)
  const entries: ZipEntry[] = []
  let cursor = 0
  while (cursor + 46 <= directory.length && entries.length < count) {
    if (u32(directory, cursor) !== 0x02014b50) throw new Error('Оглавление архива повреждено')
    const method = u16(directory, cursor + 10)
    const compressed = u32(directory, cursor + 20)
    const uncompressed = u32(directory, cursor + 24)
    const nameLength = u16(directory, cursor + 28)
    const extraLength = u16(directory, cursor + 30)
    const commentLength = u16(directory, cursor + 32)
    const localOffset = u32(directory, cursor + 42)
    const name = strFromU8(directory.subarray(cursor + 46, cursor + 46 + nameLength))
    const extra = directory.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)
    const sizes = applyZip64(extra, compressed, uncompressed, localOffset)
    entries.push({ name, method, compressedSize: sizes.compressed, uncompressedSize: sizes.uncompressed, localOffset: sizes.offset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (entries.length === 0) throw new Error('Архив пуст')
  return entries
}

/** Один файл из архива по записи оглавления. */
export async function readZipEntry(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const header = await readRange(blob, entry.localOffset, 30)
  if (u32(header, 0) !== 0x04034b50) throw new Error(`Повреждён файл «${entry.name}»`)
  const nameLength = u16(header, 26)
  const extraLength = u16(header, 28)
  const compressed = await readRange(blob, entry.localOffset + 30 + nameLength + extraLength, entry.compressedSize)
  if (entry.method === 0) return compressed
  if (entry.method === 8) return inflateSync(compressed)
  throw new Error(`Файл «${entry.name}» сжат способом ${entry.method}, его нельзя прочитать`)
}

function md5Of(name: string): string | undefined {
  const base = name.split('/').pop() ?? name
  if (base.startsWith('._') || base.startsWith('.')) return undefined
  const match = base.match(/^([a-f0-9]{32})\.[a-z0-9]+$/i)
  return match ? match[1].toLowerCase() : undefined
}

function journalTitle(name: string): string {
  const base = (name.split('/').pop() ?? name).replace(/\.json$/i, '')
  try {
    return decodeURIComponent(base)
  } catch {
    return base
  }
}

/** JSON дневника и указатель медиа. Фото и видео остаются в архиве, пока их не попросят. */
export async function loadDayOneZip(blob: Blob): Promise<DayOnePackage> {
  const listed = await listZipEntries(blob)
  let journalName = ''
  let entries: DayOneRawEntry[] | undefined
  for (const entry of listed) {
    if (!entry.name.toLowerCase().endsWith('.json') || entry.name.startsWith('__MACOSX')) continue
    let parsed: { entries?: DayOneRawEntry[] }
    try {
      parsed = JSON.parse(strFromU8(await readZipEntry(blob, entry))) as { entries?: DayOneRawEntry[] }
    } catch {
      continue
    }
    if (!Array.isArray(parsed.entries)) continue
    entries = parsed.entries
    journalName = journalTitle(entry.name)
    break
  }
  if (!entries) throw new Error('В архиве нет дневника Day One (JSON с записями)')
  const files = new Map<string, ZipEntry>()
  for (const entry of listed) {
    const md5 = md5Of(entry.name)
    if (md5 && !files.has(md5)) files.set(md5, entry)
  }
  return { journalName, entries, files }
}
