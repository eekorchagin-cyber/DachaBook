import 'fake-indexeddb/auto'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { DiaryDatabase } from '../storage/db'
import { Repository } from '../storage/repository'
import { seedFolkSigns } from '../app/seed'
import { buildBackup, restoreBackup } from './backup'

async function filled() {
  const database = new DiaryDatabase(`backup-${crypto.randomUUID()}`)
  const repo = new Repository(database, () => 'Егор')
  const lawn = await repo.create('objects', { name: 'Газон', type: 'lawn', active: true, areaM2: 200 })
  const photo = await repo.create('files', { role: 'photo', fileName: 'газон.jpg', mime: 'image/jpeg', size: 4, sha256: 'x', uploadState: 'local' })
  await database.fileContents.put({ id: photo.id, original: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }), thumb: new Blob([new Uint8Array([9])]) })
  const event = await repo.create('events', {
    type: 'work',
    date: '2025-05-18',
    objectIds: [lawn.id],
    plantGroupIds: [],
    comment: 'Прочесал и удобрил газон',
    photoIds: [photo.id],
    attachmentIds: [],
  })
  await repo.create('wateringZones', {
    name: 'Газон',
    kind: 'sprinkler',
    objectIds: [lawn.id],
    plantGroupIds: [],
    weekdays: [2, 5],
    durationMin: 20,
    fromMonth: 5,
    fromDay: 15,
    toMonth: 9,
    toDay: 15,
    skipRainMm: 5,
    active: true,
  })
  await database.settings.put({ key: 'workKinds', value: ['Подкормка', 'Свой вид'] })
  await database.settings.put({ key: 'authorName', value: 'Егор' })
  await database.settings.put({ key: 'plotAddress', value: 'СНТ «Пример», участок 1' })
  await database.settings.put({ key: 'plotLocation', value: { latitude: 55.75, longitude: 37.62 } })
  return { database, repo, event, photo }
}

async function bytes(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

describe('резервная копия', () => {
  it('архив: отдельные JSON, файлы, описание; без личных настроек', async () => {
    const { database, event, photo } = await filled()
    const { blob, fileName, manifest } = await buildBackup(database, 'test')
    expect(fileName).toMatch(/^dachabook-backup-\d{8}-\d{4}\.zip$/)
    expect(manifest).toMatchObject({ app: 'dachabook', complete: true, counts: { events: 1, objects: 1, files: 1, wateringZones: 1 } })
    const entries = unzipSync(new Uint8Array(await bytes(blob)))
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([`events/2025/${event.id}.json`, `files/originals/${photo.id}.jpg`, `files/thumbs/${photo.id}.jpg`, 'manifest.json', 'README.txt', 'settings/shared.json']),
    )
    expect(strFromU8(entries['settings/shared.json'])).not.toContain('authorName')
  })

  it('восстановление в чистую базу совпадает с исходными данными, повтор не дублирует', async () => {
    const source = await filled()
    const { blob } = await buildBackup(source.database, 'test')
    const target = new DiaryDatabase(`restore-${crypto.randomUUID()}`)

    const first = await restoreBackup(target, await bytes(blob))
    expect(first).toMatchObject({ added: 4, files: 1, conflicts: [], corrupted: [] })
    expect(await target.events.get(source.event.id)).toEqual(await source.database.events.get(source.event.id))
    expect(new Uint8Array(await (await target.fileContents.get(source.photo.id))!.original!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))

    const again = await restoreBackup(target, await bytes(blob))
    expect(again).toMatchObject({ added: 0, same: 4, files: 0 })
    expect(await target.events.count()).toBe(1)
    expect(await target.snapshots.count()).toBe(2)
    expect((await target.settings.get('plotAddress'))?.value).toBe('СНТ «Пример», участок 1')
    expect((await target.settings.get('plotLocation'))?.value).toEqual({ latitude: 55.75, longitude: 37.62 })
  })

  it('правка в копии применяется, правка здесь не затирается, расхождение попадает в отчёт', async () => {
    const source = await filled()
    const target = new DiaryDatabase(`merge-${crypto.randomUUID()}`)
    await restoreBackup(target, await bytes((await buildBackup(source.database, 'test')).blob))

    const edited = await source.repo.update('events', source.event.id, { comment: 'Правка на другом устройстве' }, source.event.revision)
    const updated = await restoreBackup(target, await bytes((await buildBackup(source.database, 'test')).blob))
    expect(updated.updated).toBe(1)
    expect((await target.events.get(source.event.id))?.comment).toBe('Правка на другом устройстве')

    const local = new Repository(target, () => 'Егор')
    await local.update('events', source.event.id, { comment: 'Местная правка' }, edited.revision)
    await source.repo.update('events', source.event.id, { comment: 'Ещё одна чужая правка' }, edited.revision)
    const conflict = await restoreBackup(target, await bytes((await buildBackup(source.database, 'test')).blob))
    expect(conflict.conflicts).toEqual(['Местная правка'])
    expect((await target.events.get(source.event.id))?.comment).toBe('Местная правка')
  })

  it('повреждённая запись не загружается; чужой и более новый архив отклоняются без изменений', async () => {
    const source = await filled()
    const entries = unzipSync(new Uint8Array(await bytes((await buildBackup(source.database, 'test')).blob)))
    const path = Object.keys(entries).find((key) => key.startsWith('events/'))!
    entries[path] = strToU8(strFromU8(entries[path]).replace('Прочесал', 'Подменил'))
    const target = new DiaryDatabase(`broken-${crypto.randomUUID()}`)
    const result = await restoreBackup(target, zipSync(entries).buffer as ArrayBuffer)
    expect(result.corrupted).toHaveLength(1)
    expect(await target.events.count()).toBe(0)

    await expect(restoreBackup(target, new TextEncoder().encode('не архив').buffer as ArrayBuffer)).rejects.toThrow(/не ZIP/)
    const newer = { ...entries, 'manifest.json': strToU8(JSON.stringify({ ...JSON.parse(strFromU8(entries['manifest.json'])), schemaVersion: 99 })) }
    await expect(restoreBackup(target, zipSync(newer).buffer as ArrayBuffer)).rejects.toThrow(/более новой версией/)
  })

  it('встроенные приметы не дублируются, расход материалов переносится вместе с записью', async () => {
    const source = await filled()
    const target = new DiaryDatabase(`seeded-${crypto.randomUUID()}`)
    expect(await seedFolkSigns(source.database)).toBe(43)
    expect(await seedFolkSigns(source.database)).toBe(0)
    await seedFolkSigns(target)
    const fertilizer = await source.repo.create('consumables', { name: 'Азофоска', unit: 'кг', seasonQuantity: 5, objectIds: [], active: true })
    await source.repo.update('events', source.event.id, { consumables: [{ consumableId: fertilizer.id, quantity: 2 }] }, source.event.revision)

    const result = await restoreBackup(target, await bytes((await buildBackup(source.database, 'test')).blob))
    expect(result.conflicts).toEqual([])
    expect(result.same).toBe(43)
    expect(await target.folkSigns.count()).toBe(43)
    expect((await target.events.get(source.event.id))?.consumables).toEqual([{ consumableId: fertilizer.id, quantity: 2 }])
    expect((await target.consumables.get(fertilizer.id))?.name).toBe('Азофоска')
  })
})
