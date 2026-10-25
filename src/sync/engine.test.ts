import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { seedFolkSigns } from '../app/seed'
import type { DiaryEvent, DocInput, StoredFile } from '../domain/types'
import { DiaryDatabase } from '../storage/db'
import { Repository } from '../storage/repository'
import { resolveConflict } from './conflicts'
import { fetchOriginal, localDataCount, pendingCount, purgeDoc, synchronize, type SyncOptions } from './engine'
import { MemoryCloud } from './memoryCloud'

function device(name: string) {
  const database = new DiaryDatabase(`sync-${name}-${crypto.randomUUID()}`)
  return { database, repo: new Repository(database, () => name), name }
}

const options = (author: string, extra: Partial<SyncOptions> = {}): SyncOptions => ({ appVersion: 'test', author, ...extra })

const event = (comment: string, extra: Partial<DocInput<DiaryEvent>> = {}): DocInput<DiaryEvent> => ({
  type: 'work',
  date: '2026-10-20',
  objectIds: [],
  plantGroupIds: [],
  comment,
  photoIds: [],
  attachmentIds: [],
  ...extra,
})

describe('синхронизация двух устройств через облако', () => {
  it('новая запись и правка переходят с устройства на устройство; повтор ничего не дублирует', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    const phone = device('iPhone')
    const lawn = await mac.repo.create('objects', { name: 'Газон', type: 'lawn', active: true })
    const created = await mac.repo.create('events', event('Стрижка газона', { objectIds: [lawn.id] }))
    expect(await pendingCount(mac.database)).toBe(2)

    expect(await synchronize(mac.database, cloud, options('Mac'))).toMatchObject({ pushed: 2, conflicts: 0 })
    expect(await pendingCount(mac.database)).toBe(0)
    expect(await synchronize(phone.database, cloud, options('iPhone'))).toMatchObject({ pulled: 2, pushed: 0 })
    expect(await phone.database.events.get(created.id)).toEqual(await mac.database.events.get(created.id))

    const onPhone = (await phone.database.events.get(created.id))!
    await phone.repo.update('events', created.id, { comment: 'Стрижка газона на 4 уровне' }, onPhone.revision)
    await synchronize(phone.database, cloud, options('iPhone'))
    expect(await synchronize(mac.database, cloud, options('Mac'))).toMatchObject({ pulled: 1, conflicts: 0 })
    expect((await mac.database.events.get(created.id))?.comment).toBe('Стрижка газона на 4 уровне')

    const again = await synchronize(mac.database, cloud, options('Mac'))
    expect(again).toMatchObject({ pulled: 0, pushed: 0 })
    expect(await mac.database.events.count()).toBe(1)
  })

  it('одну запись изменили на двух устройствах: конфликт, обе версии целы, объединение уходит в облако', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    const phone = device('iPhone')
    const created = await mac.repo.create('events', event('Подкормка'))
    await synchronize(mac.database, cloud, options('Mac'))
    await synchronize(phone.database, cloud, options('iPhone'))

    await mac.repo.update('events', created.id, { comment: 'Подкормка газона азофоской' }, (await mac.database.events.get(created.id))!.revision)
    await phone.repo.update('events', created.id, { comment: 'Подкормка. Пролил после подкормки' }, (await phone.database.events.get(created.id))!.revision)
    await synchronize(mac.database, cloud, options('Mac'))
    expect(await synchronize(phone.database, cloud, options('iPhone'))).toMatchObject({ conflicts: 1, pushed: 0 })

    const [conflict] = await phone.database.conflicts.toArray()
    expect((conflict.local as unknown as DiaryEvent).comment).toBe('Подкормка. Пролил после подкормки')
    expect((conflict.remote as unknown as DiaryEvent).comment).toBe('Подкормка газона азофоской')
    expect((await phone.database.events.get(created.id))?.comment).toBe('Подкормка. Пролил после подкормки')

    await resolveConflict(phone.database, conflict, 'merge', 'iPhone')
    expect(await phone.database.conflicts.count()).toBe(0)
    await synchronize(phone.database, cloud, options('iPhone'))
    expect(await synchronize(mac.database, cloud, options('Mac'))).toMatchObject({ conflicts: 0, pulled: 1 })
    expect((await mac.database.events.get(created.id))?.comment).toBe('Подкормка. Пролил после подкормки\n\nПодкормка газона азофоской')
  })

  it('разные записи, изменённые на разных устройствах, объединяются без конфликта', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    const phone = device('iPhone')
    await mac.repo.create('events', event('С Mac'))
    await phone.repo.create('events', event('С iPhone'))
    await synchronize(mac.database, cloud, options('Mac'))
    await synchronize(phone.database, cloud, options('iPhone'))
    await synchronize(mac.database, cloud, options('Mac'))
    expect((await mac.database.events.toArray()).map((item) => item.comment).sort()).toEqual(['С Mac', 'С iPhone'])
    expect((await phone.database.events.toArray()).map((item) => item.comment).sort()).toEqual(['С Mac', 'С iPhone'])
  })

  it('корзина переносится как правка, окончательное удаление — надгробием; правка после удаления возвращает запись', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    const phone = device('iPhone')
    const first = await mac.repo.create('events', event('В корзину'))
    const second = await mac.repo.create('events', event('Удалить навсегда'))
    await synchronize(mac.database, cloud, options('Mac'))
    await synchronize(phone.database, cloud, options('iPhone'))

    await mac.repo.remove('events', first.id, (await mac.database.events.get(first.id))!.revision)
    await purgeDoc(mac.database, 'events', second.id)
    await synchronize(mac.database, cloud, options('Mac'))
    await synchronize(phone.database, cloud, options('iPhone'))
    expect((await phone.database.events.get(first.id))?.deletedAt).toBeTruthy()
    expect(await phone.database.events.get(second.id)).toBeUndefined()

    // Удалили на Mac, а на iPhone в это время изменили — запись возвращается.
    const third = await mac.repo.create('events', event('Спорная'))
    await synchronize(mac.database, cloud, options('Mac'))
    await synchronize(phone.database, cloud, options('iPhone'))
    await phone.repo.update('events', third.id, { comment: 'Спорная, дополнил' }, (await phone.database.events.get(third.id))!.revision)
    await synchronize(phone.database, cloud, options('iPhone'))
    await purgeDoc(mac.database, 'events', third.id)
    await synchronize(mac.database, cloud, options('Mac'))
    expect((await mac.database.events.get(third.id))?.comment).toBe('Спорная, дополнил')
  })

  it('фото: оригинал и уменьшенная копия в облаке, на другом устройстве — копия сразу, оригинал по запросу', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    const phone = device('iPhone')
    const file = await mac.repo.create('files', { role: 'photo', fileName: 'газон.JPG', mime: 'image/jpeg', size: 3, sha256: 'x', uploadState: 'local' })
    await mac.database.fileContents.put({ id: file.id, original: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), thumb: new Blob([new Uint8Array([9])]) })
    expect(await synchronize(mac.database, cloud, options('Mac'))).toMatchObject({ uploadedFiles: 1 })
    expect(cloud.files.has(`files/originals/${file.id}.jpg`)).toBe(true)

    await synchronize(phone.database, cloud, options('iPhone'))
    const content = await phone.database.fileContents.get(file.id)
    expect(content?.thumb).toBeTruthy()
    expect(content?.original).toBeUndefined()
    const original = await fetchOriginal(phone.database, cloud, (await phone.database.files.get(file.id)) as StoredFile)
    expect(new Uint8Array(await original!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    // Фото после снимка приходит отдельной уменьшенной копией.
    const later = await mac.repo.create('files', { role: 'photo', fileName: 'туя.jpg', mime: 'image/jpeg', size: 1, sha256: 'y', uploadState: 'local' })
    await mac.database.fileContents.put({ id: later.id, original: new Blob([new Uint8Array([4])]), thumb: new Blob([new Uint8Array([5])]) })
    await synchronize(mac.database, cloud, options('Mac'))
    expect(await synchronize(phone.database, cloud, options('iPhone'))).toMatchObject({ pulled: 1, thumbs: 1 })
  })

  it('новое устройство получает дневник одним снимком, а не тысячей файлов; одинаковые приметы не дублируются', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    await seedFolkSigns(mac.database)
    for (let index = 0; index < 30; index++) await mac.repo.create('events', event(`Запись ${index}`))
    await synchronize(mac.database, cloud, options('Mac', { snapshotIntervalMs: 0 }))

    const windows = device('Windows')
    await seedFolkSigns(windows.database)
    const readsBefore = cloud.reads
    const result = await synchronize(windows.database, cloud, options('Windows'))
    expect(result).toMatchObject({ bootstrapped: true, conflicts: 0, pushed: 0 })
    expect(cloud.reads - readsBefore).toBeLessThan(10)
    expect(await windows.database.events.count()).toBe(30)
    expect(await windows.database.folkSigns.count()).toBe(43)
    expect(await pendingCount(windows.database)).toBe(0)
  })

  it('«взять из облака»: свои данные устройства уходят в снимок и заменяются дневником из облака', async () => {
    const cloud = new MemoryCloud()
    const mac = device('Mac')
    await mac.repo.create('events', event('Настоящий дневник'))
    await synchronize(mac.database, cloud, options('Mac', { snapshotIntervalMs: 0 }))

    const phone = device('iPhone')
    await phone.repo.create('events', event('Пробная запись'))
    expect(await localDataCount(phone.database)).toBe(1)
    await synchronize(phone.database, cloud, options('iPhone', { firstConnect: 'replace' }))
    expect((await phone.database.events.toArray()).map((item) => item.comment)).toEqual(['Настоящий дневник'])
    expect(await phone.database.snapshots.count()).toBe(1)
  })

  it('не смешивает два разных дневника', async () => {
    const mac = device('Mac')
    await synchronize(mac.database, new MemoryCloud(), options('Mac'))
    const other = new MemoryCloud()
    await synchronize(device('x').database, other, options('x'))
    await expect(synchronize(mac.database, other, options('Mac'))).rejects.toThrow(/другой дневник/)
  })
})
