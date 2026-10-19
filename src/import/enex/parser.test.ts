import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import SparkMD5 from 'spark-md5'
import { describe, expect, it } from 'vitest'
import { EnexStreamParser, missingMediaHashes, parseEnexStream, type EnexNote } from './parser'

const imageBytes = new Uint8Array(3000).map((_, i) => (i * 7) % 256)
const imageBase64 = Buffer.from(imageBytes).toString('base64').replace(/(.{76})/g, '$1\n')
const imageMd5 = SparkMD5.ArrayBuffer.hash(imageBytes.buffer)

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261019T160852Z" application="Evernote" version="11.8.1">
  <note>
    <title>Дневник &amp; заметки</title>
    <created>20190331T092049Z</created>
    <updated>20250525T131652Z</updated>
    <tag>дача</tag>
    <tag>газон</tag>
    <note-attributes>
      <author>Автор</author>
      <source>mobile.iphone</source>
    </note-attributes>
    <content>
      <![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>Скосил траву &gt; 5 см</div><en-todo checked="true"/><en-media hash="${imageMd5}" type="image/jpeg"/></en-note>]]>
    </content>
    <resource>
      <data encoding="base64">
${imageBase64}
      </data>
      <mime>image/jpeg</mime>
      <width>40</width>
      <height>25</height>
      <resource-attributes>
        <file-name>Фото участка.jpg</file-name>
        <application-data key="x">служебное</application-data>
      </resource-attributes>
    </resource>
  </note>
  <note>
    <title>Пустая</title>
    <content><![CDATA[<en-note/>]]></content>
  </note>
</en-export>
`

function parseInChunks(source: string, size: number): EnexNote[] {
  const parser = new EnexStreamParser()
  const notes: EnexNote[] = []
  for (let i = 0; i < source.length; i += size) notes.push(...parser.feed(source.slice(i, i + size)))
  notes.push(...parser.end())
  return notes
}

describe('EnexStreamParser', () => {
  it('разбирает заметки, атрибуты, CDATA и вложения', async () => {
    const [note, empty] = parseInChunks(SAMPLE, SAMPLE.length)
    expect(note.title).toBe('Дневник & заметки')
    expect(note.created).toBe('20190331T092049Z')
    expect(note.tags).toEqual(['дача', 'газон'])
    expect(note.attributes).toEqual({ author: 'Автор', source: 'mobile.iphone' })
    expect(note.content).toContain('Скосил траву &gt; 5 см')
    expect(note.content).toContain('<en-todo checked="true"/>')
    expect(note.resources).toHaveLength(1)
    const [resource] = note.resources
    expect(resource).toMatchObject({ mime: 'image/jpeg', fileName: 'Фото участка.jpg', width: 40, height: 25 })
    expect(resource.size).toBe(imageBytes.length)
    expect(resource.md5).toBe(imageMd5)
    expect(new Uint8Array(await resource.data.arrayBuffer())).toEqual(imageBytes)
    expect(missingMediaHashes(note)).toEqual([])
    expect(empty.title).toBe('Пустая')
    expect(empty.resources).toEqual([])
  })

  it('даёт одинаковый результат при любом разбиении на куски', () => {
    const reference = parseInChunks(SAMPLE, SAMPLE.length)
    for (const size of [1, 2, 3, 5, 7, 13, 64, 1000]) {
      const notes = parseInChunks(SAMPLE, size)
      expect(notes.map((n) => [n.title, n.content, n.tags, n.resources.map((r) => [r.md5, r.size])])).toEqual(
        reference.map((n) => [n.title, n.content, n.tags, n.resources.map((r) => [r.md5, r.size])]),
      )
    }
  })

  it('сообщает об оборванном файле', () => {
    const parser = new EnexStreamParser()
    parser.feed(SAMPLE.slice(0, SAMPLE.length / 2))
    expect(() => parser.end()).toThrow(/оборван/)
  })

  it('находит en-media без вложения', () => {
    const [note] = parseInChunks(SAMPLE.replace(/<resource>[\s\S]*<\/resource>/, ''), 100)
    expect(missingMediaHashes(note)).toEqual([imageMd5])
  })
})

const samplesDir = join(import.meta.dirname, '../../../DOCS/samples')
const samples = existsSync(samplesDir) ? readdirSync(samplesDir).filter((file) => file.endsWith('.enex')) : []

describe.skipIf(samples.length === 0)('образцы заказчика (только локально)', () => {
  it.each(samples)('%s разбирается, все en-media найдены', async (file) => {
    const stream = Readable.toWeb(createReadStream(join(samplesDir, file), { highWaterMark: 256 * 1024 }))
    const notes: EnexNote[] = []
    for await (const note of parseEnexStream(stream as ReadableStream<Uint8Array>)) notes.push(note)
    expect(notes.length).toBeGreaterThan(0)
    for (const note of notes) {
      expect(note.title).not.toBe('')
      expect(missingMediaHashes(note)).toEqual([])
      for (const resource of note.resources) {
        expect(resource.size).toBeGreaterThan(0)
        expect(resource.data.size).toBe(resource.size)
      }
    }
  }, 120_000)
})
