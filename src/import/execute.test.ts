// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../lib/hash'
import { DiaryDatabase } from '../storage/db'
import { Repository } from '../storage/repository'
import { parseEnexStream, type EnexNote } from './enex/parser'
import { defaultDecisions, executeImport, existingIndex, type FileAdapter } from './execute'
import { buildProposal, type ImportFile } from './proposal'

const samplesDir = join(import.meta.dirname, '../../DOCS/samples')
const sampleFiles = existsSync(samplesDir) ? readdirSync(samplesDir).filter((file) => file.endsWith('.enex')) : []

async function readFile(fileName: string): Promise<ImportFile> {
  const notes: EnexNote[] = []
  const stream = Readable.toWeb(createReadStream(join(samplesDir, fileName))) as ReadableStream<Uint8Array>
  for await (const note of parseEnexStream(stream)) notes.push(note)
  return { fileName, notes }
}

async function setup() {
  const database = new DiaryDatabase(`import-${crypto.randomUUID()}`)
  const repo = new Repository(database, () => 'Тест')
  for (const name of ['Газон', 'Сад', 'Грядки', 'Участок целиком', 'Дом и хозяйство']) {
    await repo.create('objects', { name, type: 'place', active: true })
  }
  const bySha = new Map<string, string>()
  const store = async (blob: Blob, fileName: string, role: 'photo' | 'attachment') => {
    const sha256 = await sha256Hex(blob)
    const known = bySha.get(`${role}|${sha256}`)
    if (known) return known
    const file = await repo.create('files', { role, fileName, mime: blob.type, size: blob.size, sha256, uploadState: 'local' })
    bySha.set(`${role}|${sha256}`, file.id)
    return file.id
  }
  const files: FileAdapter = { photo: (blob, name) => store(blob, name, 'photo'), attachment: (blob, name) => store(blob, name, 'attachment') }
  return { database, repo, files, objects: await database.objects.toArray() }
}

describe.skipIf(sampleFiles.length === 0)('импорт всех образцов (только локально)', () => {
  it('импортирует, а повторный импорт ничего не дублирует', async () => {
    const context = await setup()
    const proposal = buildProposal(await Promise.all(sampleFiles.map(readFile)))

    const first = await executeImport(proposal, defaultDecisions(proposal, context.objects, await existingIndex(context.database)), context)
    expect(first.errors).toEqual([])
    expect(first.events).toBe(334)
    expect(first.planItems).toBe(117 + 18)
    expect(first.references).toBe(7)
    expect(first.archiveItems).toBe(1281 + 6)
    expect(await context.database.snapshots.count()).toBe(1)

    const [lawn] = await context.database.events.where('date').equals('2025-05-24').toArray()
    expect(lawn.comment).toMatch(/^Газон вновь вычесал/)
    expect(lawn.attachmentIds).toHaveLength(1)
    expect((await context.database.files.get(lawn.attachmentIds[0]))?.fileName).toBe('Газонная смесь.xlsx')
    const sameImage = (await context.database.files.toArray()).filter((file) => file.fileName === 'IMG_8386 (изменено).JPG')
    expect(sameImage).toHaveLength(1)

    const archive = await context.database.importArchive.toArray()
    const unused = archive.filter((item) => item.createdRecordIds.length === 0)
    expect(unused.length).toBeGreaterThan(0)

    const again = await executeImport(proposal, defaultDecisions(proposal, context.objects, await existingIndex(context.database)), context)
    expect(again.errors).toEqual([])
    expect(again).toMatchObject({ events: 0, planItems: 0, references: 0, archiveItems: 0 })
    expect(await context.database.events.count()).toBe(334)
  }, 180_000)
})
