// @vitest-environment happy-dom
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { parseEnexStream, type EnexNote } from './enex/parser'
import { buildProposal, type ImportFile } from './proposal'
import { looksLikeWork, similarity, suggestObject, suggestWorkKind } from './suggest'

describe('подсказки', () => {
  it('объект по ключевым словам', () => {
    expect(suggestObject('Газон прочесал и удобрил')).toBe('Газон')
    expect(suggestObject('Откачал септик')).toBe('Дом и хозяйство')
    expect(suggestObject('посадили в грядки лук, чеснок')).toBe('Грядки')
    expect(suggestObject('Подкормка гортензии')).toBe('Сад')
    expect(suggestObject('Посадили колеусы у сосны')).toBe('Сад')
    expect(suggestObject('Праздники не были на даче')).toBe('Участок целиком')
  })

  it('вид работы и признак работы', () => {
    expect(suggestWorkKind('Стрижка газона на 4 уровне')).toBe('Стрижка газона')
    expect(suggestWorkKind('Обработали актарой все деревья')).toBe('Обработка от вредителей и болезней')
    expect(looksLikeWork('Обрезал верхушку елки')).toBe(true)
    expect(looksLikeWork('Одуванчики в стадии цветения.')).toBe(false)
  })

  it('сходство текстов', () => {
    expect(similarity('подвязали помидоры, отпасынковали их', 'подвязали помидоры, отпасынуовали их')).toBeGreaterThan(0.85)
    expect(similarity('Подкормка гортензии Forte', 'Подкормка хосты, астильбы комплексным удобрением')).toBeLessThan(0.85)
  })
})

const samplesDir = join(import.meta.dirname, '../../DOCS/samples')
const sampleFiles = existsSync(samplesDir) ? readdirSync(samplesDir).filter((file) => file.endsWith('.enex')) : []

async function readFile(fileName: string): Promise<ImportFile> {
  const notes: EnexNote[] = []
  const stream = Readable.toWeb(createReadStream(join(samplesDir, fileName))) as ReadableStream<Uint8Array>
  for await (const note of parseEnexStream(stream)) notes.push(note)
  return { fileName, notes }
}

describe.skipIf(sampleFiles.length === 0)('все образцы заказчика (только локально)', () => {
  it('собирает предложение импорта', async () => {
    const files = await Promise.all(sampleFiles.map(readFile))
    const proposal = buildProposal(files)
    const exact = proposal.events.filter((item) => !item.needsConfirmation)
    const summary = {
      notes: proposal.notes.length,
      diaryRows: proposal.rows.length,
      latestSeason: proposal.latestSeason,
      events: exact.length,
      needsConfirmation: proposal.events.length - exact.length,
      withVariants: exact.filter((item) => item.variants.length > 1).length,
      multiFile: exact.filter((item) => new Set(item.sources.map((source) => source.fileName)).size > 1).length,
      planWork: proposal.plan.filter((item) => item.itemType === 'work' && !item.fromPastOnly).length,
      planWorkPast: proposal.plan.filter((item) => item.itemType === 'work' && item.fromPastOnly).length,
      planObservation: proposal.plan.filter((item) => item.itemType === 'observation' && !item.fromPastOnly).length,
      planObservationPast: proposal.plan.filter((item) => item.itemType === 'observation' && item.fromPastOnly).length,
      withSeasonsDone: proposal.plan.filter((item) => item.seasonsDone.length > 0).length,
      outsideFiles: proposal.outside.length,
    }
    expect(summary).toEqual({
      notes: 6,
      diaryRows: 1281,
      latestSeason: 2025,
      events: 334,
      needsConfirmation: 11,
      withVariants: 4,
      multiFile: 169,
      planWork: 117,
      planWorkPast: 120,
      planObservation: 18,
      planObservationPast: 19,
      withSeasonsDone: 197,
      outsideFiles: 7,
    })
  }, 120_000)
})
