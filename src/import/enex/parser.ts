import SparkMD5 from 'spark-md5'

export interface EnexResource {
  mime: string
  fileName?: string
  sourceUrl?: string
  width?: number
  height?: number
  size: number
  /** MD5 содержимого: по нему en-media в тексте заметки ссылается на ресурс. */
  md5: string
  data: Blob
}

export interface EnexNote {
  title: string
  created?: string
  updated?: string
  tags: string[]
  attributes: Record<string, string>
  /** ENML (XHTML) заметки без изменений. */
  content: string
  resources: EnexResource[]
}

export interface EnexExportInfo {
  exportDate?: string
  application?: string
  version?: string
}

interface ResourceDraft {
  mime: string
  fileName?: string
  sourceUrl?: string
  width?: number
  height?: number
  data?: Blob
  size: number
  md5: string
}

/** Сколько декодированных байт копить в памяти, прежде чем сложить их в Blob. */
const BLOB_FOLD_BYTES = 8 * 1024 * 1024

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '')
  }
  return attrs
}

/**
 * Потоковый разбор файла экспорта Evernote (ENEX).
 * Вложения декодируются из Base64 по мере чтения и складываются в Blob,
 * поэтому файл не держится в памяти целиком в виде строки.
 */
export class EnexStreamParser {
  info: EnexExportInfo = {}

  private buffer = ''
  private stack: string[] = []
  private text = ''
  private note: EnexNote | null = null
  private resource: ResourceDraft | null = null
  private inData = false
  private base64Tail = ''
  private dataParts: Uint8Array<ArrayBuffer>[] = []
  private dataPartsBytes = 0
  private dataBlob: Blob | null = null
  private md5 = new SparkMD5.ArrayBuffer()
  private ready: EnexNote[] = []

  feed(chunk: string): EnexNote[] {
    this.buffer += chunk
    this.process(false)
    return this.drain()
  }

  end(): EnexNote[] {
    this.process(true)
    if (this.stack.length > 0) {
      throw new Error(`Файл ENEX оборван: не закрыт элемент <${this.stack[this.stack.length - 1]}>`)
    }
    return this.drain()
  }

  private drain(): EnexNote[] {
    const notes = this.ready
    this.ready = []
    return notes
  }

  private process(final: boolean): void {
    const buf = this.buffer
    let pos = 0
    while (pos < buf.length) {
      const lt = buf.indexOf('<', pos)
      if (this.inData) {
        const end = lt === -1 ? buf.length : lt
        this.appendBase64(buf.slice(pos, end))
        pos = end
        if (lt === -1) break
      } else if (lt === -1) {
        if (final) this.text += decodeEntities(buf.slice(pos))
        else break
        pos = buf.length
        break
      } else if (lt > pos) {
        this.text += decodeEntities(buf.slice(pos, lt))
        pos = lt
      }

      const rest = buf.length - pos
      if (buf.startsWith('<![CDATA[', pos)) {
        const close = buf.indexOf(']]>', pos + 9)
        if (close === -1) break
        this.text += buf.slice(pos + 9, close)
        pos = close + 3
        continue
      }
      if (rest < 9 && '<![CDATA['.startsWith(buf.slice(pos)) && !final) break
      if (buf.startsWith('<!--', pos)) {
        const close = buf.indexOf('-->', pos + 4)
        if (close === -1) break
        pos = close + 3
        continue
      }
      const gt = buf.indexOf('>', pos)
      if (gt === -1) break
      const tag = buf.slice(pos + 1, gt)
      pos = gt + 1
      if (tag.startsWith('?') || tag.startsWith('!')) continue
      if (tag.startsWith('/')) {
        this.close(tag.slice(1).trim())
        continue
      }
      const selfClosing = tag.endsWith('/')
      const body = selfClosing ? tag.slice(0, -1) : tag
      const nameEnd = body.search(/[\s/]/)
      const name = nameEnd === -1 ? body : body.slice(0, nameEnd)
      this.open(name, nameEnd === -1 ? '' : body.slice(nameEnd))
      if (selfClosing) this.close(name)
    }
    this.buffer = buf.slice(pos)
  }

  private open(name: string, attrSource: string): void {
    this.stack.push(name)
    this.text = ''
    const parent = this.stack[this.stack.length - 2]
    if (name === 'en-export') {
      const attrs = parseAttributes(attrSource)
      this.info = { exportDate: attrs['export-date'], application: attrs.application, version: attrs.version }
    } else if (name === 'note') {
      this.note = { title: '', tags: [], attributes: {}, content: '', resources: [] }
    } else if (name === 'resource' && this.note) {
      this.resource = { mime: 'application/octet-stream', size: 0, md5: '' }
    } else if (name === 'data' && parent === 'resource') {
      this.inData = true
      this.base64Tail = ''
      this.dataParts = []
      this.dataPartsBytes = 0
      this.dataBlob = null
      this.md5 = new SparkMD5.ArrayBuffer()
    }
  }

  private close(name: string): void {
    const top = this.stack.pop()
    if (top !== name) {
      throw new Error(`Нарушена структура ENEX: ожидался </${top ?? '?'}>, найден </${name}>`)
    }
    const parent = this.stack[this.stack.length - 1]
    const value = this.text.trim()
    this.text = ''

    if (name === 'data' && this.inData) {
      this.finishData()
      return
    }
    const note = this.note
    if (!note) return

    if (parent === 'note') {
      if (name === 'title') note.title = value
      else if (name === 'created') note.created = value
      else if (name === 'updated') note.updated = value
      else if (name === 'tag') note.tags.push(value)
      else if (name === 'content') note.content = value
    } else if (parent === 'note-attributes') {
      note.attributes[name] = value
    } else if (parent === 'resource' && this.resource) {
      if (name === 'mime') this.resource.mime = value
      else if (name === 'width') this.resource.width = Number(value) || undefined
      else if (name === 'height') this.resource.height = Number(value) || undefined
    } else if (parent === 'resource-attributes' && this.resource) {
      if (name === 'file-name') this.resource.fileName = value
      else if (name === 'source-url') this.resource.sourceUrl = value
    }

    if (name === 'resource' && this.resource) {
      const draft = this.resource
      const data = new Blob(draft.data ? [draft.data] : [], { type: draft.mime })
      note.resources.push({
        mime: draft.mime,
        fileName: draft.fileName,
        sourceUrl: draft.sourceUrl,
        width: draft.width,
        height: draft.height,
        size: draft.size,
        md5: draft.md5,
        data,
      })
      this.resource = null
    } else if (name === 'note') {
      this.ready.push(note)
      this.note = null
    }
  }

  private appendBase64(chunk: string): void {
    const clean = this.base64Tail + chunk.replace(/[^A-Za-z0-9+/=]/g, '')
    const usable = clean.length - (clean.length % 4)
    this.base64Tail = clean.slice(usable)
    if (usable === 0) return
    const binary = atob(clean.slice(0, usable))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    this.md5.append(bytes.buffer)
    this.dataParts.push(bytes)
    this.dataPartsBytes += bytes.length
    if (this.dataPartsBytes >= BLOB_FOLD_BYTES) this.foldParts()
  }

  private foldParts(): void {
    const parts: BlobPart[] = this.dataBlob ? [this.dataBlob, ...this.dataParts] : this.dataParts
    this.dataBlob = new Blob(parts)
    this.dataParts = []
    this.dataPartsBytes = 0
  }

  private finishData(): void {
    if (this.base64Tail.replace(/=/g, '').length > 0) {
      throw new Error('Повреждены данные вложения ENEX: неполная последовательность Base64')
    }
    this.foldParts()
    this.inData = false
    if (this.resource && this.dataBlob) {
      this.resource.data = this.dataBlob
      this.resource.size = this.dataBlob.size
      this.resource.md5 = this.md5.end()
    }
    this.dataBlob = null
  }
}

export interface EnexParseProgress {
  bytesRead: number
  notes: number
}

/** Разбирает поток байт ENEX и по одной отдаёт заметки по мере готовности. */
export async function* parseEnexStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (progress: EnexParseProgress) => void,
): AsyncGenerator<EnexNote, EnexExportInfo> {
  const parser = new EnexStreamParser()
  const decoder = new TextDecoder('utf-8')
  const reader = stream.getReader()
  let bytesRead = 0
  let notes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      for (const note of parser.feed(decoder.decode(value, { stream: true }))) {
        notes++
        yield note
      }
      onProgress?.({ bytesRead, notes })
    }
    for (const note of parser.feed(decoder.decode())) {
      notes++
      yield note
    }
    for (const note of parser.end()) {
      notes++
      yield note
    }
  } finally {
    reader.releaseLock()
  }
  return parser.info
}

/** Хэши en-media из текста заметки, для которых нет вложения с таким MD5. */
export function missingMediaHashes(note: EnexNote): string[] {
  const known = new Set(note.resources.map((resource) => resource.md5))
  const missing: string[] = []
  for (const match of note.content.matchAll(/<en-media\b[^>]*\bhash="([0-9a-f]{32})"/gi)) {
    if (!known.has(match[1].toLowerCase())) missing.push(match[1])
  }
  return missing
}
