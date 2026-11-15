import 'fake-indexeddb/auto'
import { existsSync, openAsBlob } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../lib/hash'
import { DiaryDatabase } from '../../storage/db'
import { Repository } from '../../storage/repository'
import type { FileAdapter } from '../execute'
import { loadDayOneZip, readZipEntry } from './archive'
import { importDayOne } from './import'

const realZip = '/Users/egorkorchagin/Downloads/2026-11-8-Дача.zip'

function journal(entries: unknown[]): Uint8Array {
  return strToU8(JSON.stringify({ metadata: { version: '1.0' }, entries }))
}

async function setup() {
  const database = new DiaryDatabase(`dayone-${crypto.randomUUID()}`)
  const repo = new Repository(database, () => 'Тест')
  const files: FileAdapter = {
    photo: async (blob, fileName) => {
      const file = await repo.create('files', { role: 'photo', fileName, mime: blob.type, size: blob.size, sha256: await sha256Hex(blob), uploadState: 'local' })
      return file.id
    },
    attachment: async (blob, fileName) => {
      const file = await repo.create('files', { role: 'attachment', fileName, mime: blob.type, size: blob.size, sha256: await sha256Hex(blob), uploadState: 'local' })
      return file.id
    },
  }
  return { database, repo, files }
}

describe('импорт архива Day One', () => {
  it('переносит запись с фото и не повторяет её', async () => {
    const bytes = zipSync({
      'Дача.json': journal([
        {
          uuid: 'ONE',
          creationDate: '2013-06-01T02:30:00Z',
          timeZone: 'Asia/Krasnoyarsk',
          text: 'Рассада\\.',
          photos: [{ md5: 'aabbccdd11223344aabbccdd11223344', type: 'jpeg', filename: 'bed.jpg', orderInEntry: 0 }],
        },
        { uuid: 'EMPTY', creationDate: '2013-06-02T00:00:00Z', text: '' },
      ]),
      'photos/aabbccdd11223344aabbccdd11223344.jpeg': new Uint8Array([1, 2, 3, 4]),
    })
    const blob = new Blob([bytes])
    const pack = await loadDayOneZip(blob)
    expect(pack.journalName).toBe('Дача')
    expect(pack.entries).toHaveLength(2)
    const context = await setup()
    const first = await importDayOne(pack, 'Дача.zip', { photos: true, videos: false }, { blob, ...context })
    expect(first.errors).toEqual([])
    expect(first).toMatchObject({ events: 1, skipped: 0, files: 1, missing: 0 })
    const [event] = await context.database.events.toArray()
    expect(event.date).toBe('2013-06-01')
    expect(event.time).toBe('10:30')
    expect(event.comment).toBe('Рассада.')
    expect(event.type).toBe('observation')
    expect(event.source).toMatchObject({ app: 'dayone', fingerprint: 'dayone:ONE' })
    expect(event.photoIds).toHaveLength(1)

    const again = await importDayOne(pack, 'Дача.zip', { photos: true, videos: false }, { blob, ...context })
    expect(again).toMatchObject({ events: 0, skipped: 1, files: 0 })
    expect(await context.database.events.count()).toBe(1)
    expect(await context.database.files.count()).toBe(1)
  })

  it.skipIf(!existsSync(realZip))('читает журнал «Дача» из архива, не загружая фото', async () => {
    const blob = await openAsBlob(realZip)
    const pack = await loadDayOneZip(blob)
    expect(pack.journalName).toBe('Дача')
    expect(pack.entries.length).toBe(418)
    expect(pack.files.has('b64d462d8f6e8a01d622fb67bd45ba52')).toBe(true)
    const pdf = pack.files.get('f5caf26c76c726d4f2390f024ccc90dc')
    expect(pdf?.uncompressedSize).toBe(61143)
    expect(pdf ? (await readZipEntry(blob, pdf)).length : 0).toBe(61143)
  }, 30_000)
})
