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
import { makeParts } from './parts'
import { buildProposal, type ImportFile } from './proposal'
import { reorderImported } from './reorder'
import { filterEvents } from '../domain/diaryFilter'

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

describe('разделение строки при импорте', () => {
  const row = (week: string, todo: string, text: string, date: string) =>
    `<tr><td>${week}</td><td>${todo}</td><td>${text}</td><td>${date}</td></tr>`
  const header = row('Недели', '', 'Работы, наблюдения', 'Дата выполнения')
  const table = (rows: string) => `<table>${header}${rows}</table>`
  const content = `<en-note><div>Сентябрь</div>${table(row('1', '', 'Листья опали. Убрали листву. Обвязал деревья защитной лентой.', '20.09.2025'))}${table('')}${table('')}</en-note>`
  const note: EnexNote = { title: 'Дневник дачных работ 2025 г', tags: [], attributes: {}, content, resources: [] }

  it('одна строка становится тремя записями, повторный импорт их узнаёт', async () => {
    const context = await setup()
    const groups = [await context.repo.create('plantGroups', { name: 'Деревья', objectIds: [], active: true })]
    const proposal = buildProposal([{ fileName: 'd.enex', notes: [note] }])
    expect(proposal.events).toHaveLength(1)
    expect(proposal.events[0].splittable).toBe(true)

    const decisions = defaultDecisions(proposal, context.objects, await existingIndex(context.database))
    const key = proposal.events[0].key
    decisions.events[key].parts = makeParts(proposal.events[0].text, context.objects, groups)
    const first = await executeImport(proposal, decisions, context)
    expect(first.events).toBe(3)

    const events = await context.database.events.toArray()
    expect(events.map((event) => [event.type, event.comment])).toEqual(
      expect.arrayContaining([
        ['observation', 'Листья опали.'],
        ['work', 'Убрали листву.'],
        ['work', 'Обвязал деревья защитной лентой.'],
      ]),
    )
    expect(events.find((event) => event.comment.startsWith('Обвязал'))?.plantGroupIds).toEqual([groups[0].id])
    const [archive] = await context.database.importArchive.toArray()
    expect(archive.createdRecordIds).toHaveLength(3)

    const again = await executeImport(proposal, defaultDecisions(proposal, context.objects, await existingIndex(context.database)), context)
    expect(again.events).toBe(0)
  })
})

describe('фрагменты вне таблиц', () => {
  const row = (week: string, text: string, date: string) => `<tr><td>${week}</td><td></td><td>${text}</td><td>${date}</td></tr>`
  const header = row('Недели', 'Работы, наблюдения', 'Дата выполнения')
  const content = `<en-note><div>Апрель</div><table>${header}${row('1', 'Газон в снегу', '14.04.2021')}</table><div>https://ogorod.ru/статья</div><table>${header}</table><table>${header}</table></en-note>`
  const note: EnexNote = { title: 'Дневник дачных работ 2021 г', tags: [], attributes: {}, content, resources: [] }

  it('ссылку после строки можно прикрепить к записи выше', async () => {
    const context = await setup()
    const proposal = buildProposal([{ fileName: 'd.enex', notes: [note] }])
    expect(proposal.outsidePieces).toHaveLength(1)
    expect(proposal.outsidePieces[0].above?.row.text).toBe('Газон в снегу')

    const decisions = defaultDecisions(proposal, context.objects, await existingIndex(context.database))
    decisions.outsideTargets[proposal.outsidePieces[0].key] = 'above'
    const result = await executeImport(proposal, decisions, context)
    expect(result.errors).toEqual([])
    const [event] = await context.database.events.toArray()
    expect(event.comment).toBe('Газон в снегу\n\nhttps://ogorod.ru/статья')
    expect(await context.database.references.count()).toBe(0)
  })
})

describe('строка, изменённая в Evernote после импорта', () => {
  const row = (text: string, date: string) => `<tr><td>1</td><td><en-todo/></td><td>${text}</td><td>${date}</td></tr>`
  const header = `<tr><td>Недели</td><td></td><td>Работы, наблюдения</td><td>Дата выполнения</td></tr>`
  const note = (text: string): EnexNote => ({
    title: 'Дневник дачных работ 2019 г',
    tags: [],
    attributes: {},
    content: `<en-note><div>Июль</div><table>${header}${row(text, '06.07.2019')}</table><table>${header}</table><table>${header}</table></en-note>`,
    resources: [],
  })

  it('показывается как изменённая; «обновить» меняет запись без дубля', async () => {
    const context = await setup()
    const first = buildProposal([{ fileName: 'd.enex', notes: [note('Подвязали помидоры, отпасынковали их')] }])
    await executeImport(first, defaultDecisions(first, context.objects, await existingIndex(context.database)), context)

    const second = buildProposal([{ fileName: 'd.enex', notes: [note('Подвязали помидоры, отпасынковали их. Сняли первые огурцы')] }])
    const decisions = defaultDecisions(second, context.objects, await existingIndex(context.database))
    const decision = decisions.events[second.events[0].key]
    expect(decision.change?.oldText).toBe('Подвязали помидоры, отпасынковали их')
    expect(decision.include).toBe(false)

    decision.change!.action = 'update'
    const result = await executeImport(second, decisions, context)
    expect(result).toMatchObject({ events: 0, updatedEvents: 1, errors: [] })
    const events = await context.database.events.toArray()
    expect(events).toHaveLength(1)
    expect(events[0].comment).toBe('Подвязали помидоры, отпасынковали их. Сняли первые огурцы')
  })
})

describe('порядок записей одного дня', () => {
  const row = (text: string) => `<tr><td>1</td><td></td><td>${text}</td><td>18.05.2025</td></tr>`
  const header = '<tr><td>Недели</td><td></td><td>Работы, наблюдения</td><td>Дата выполнения</td></tr>'
  const content = `<en-note><div>Май</div><table>${header}${row('Газон сухой')}${row('Прочесал газон')}${row('Запустил автополив')}</table><table>${header}</table><table>${header}</table></en-note>`
  const note: EnexNote = { title: 'Дневник дачных работ 2025 г', tags: [], attributes: {}, content, resources: [] }

  it('последняя строка дня — сверху; перестановка по файлу чинит записи с одинаковым временем внесения', async () => {
    const context = await setup()
    const proposal = buildProposal([{ fileName: 'd.enex', notes: [note] }])
    await executeImport(proposal, defaultDecisions(proposal, context.objects, await existingIndex(context.database)), context)
    const order = async () => filterEvents(await context.database.events.toArray(), {}).map((event) => event.comment)
    expect(await order()).toEqual(['Запустил автополив', 'Прочесал газон', 'Газон сухой'])

    // Так выглядели записи, импортированные до исправления: одно время внесения на всех.
    for (const event of await context.database.events.toArray()) await context.database.events.update(event.id, { createdAt: '2026-10-25T05:00:00.000Z' })
    expect(await reorderImported(context.database, proposal)).toBe(3)
    expect(await order()).toEqual(['Запустил автополив', 'Прочесал газон', 'Газон сухой'])
    expect((await context.database.events.toArray()).every((event) => event.revision && event.checksum)).toBe(true)
  })
})
