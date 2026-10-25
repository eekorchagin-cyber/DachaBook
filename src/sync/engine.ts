import SparkMD5 from 'spark-md5'
import { strFromU8, unzipSync } from 'fflate'
import { buildBackup } from '../backup/backup'
import { createSnapshot } from '../storage/snapshots'
import type { DocMeta, StoredFile } from '../domain/types'
import { DOC_TABLES, type ConflictRecord, type DiaryDatabase, type SyncRecord } from '../storage/db'
import { verifyChecksum } from '../storage/repository'
import type { CloudAdapter, RemoteEntry } from './cloud'

export type Collection = (typeof DOC_TABLES)[number]
type Doc = DocMeta & Record<string, unknown>

/** Окончательно удалённая запись: в облаке остаётся надгробие, чтобы её удалили и другие устройства. */
export interface Tombstone {
  id: string
  revision: string
  purgedAt: string
  purgedBy: string
}

export interface DiaryManifest {
  app: 'dachabook'
  format: number
  diaryId: string
  createdAt: string
  snapshot?: { path: string; at: string }
}

export interface SyncMeta {
  diaryId: string
  cursors: Partial<Record<Collection, string>>
  lastSuccessAt?: string
}

export interface SyncResult {
  pulled: number
  pushed: number
  conflicts: number
  thumbs: number
  uploadedFiles: number
  bootstrapped: boolean
  errors: string[]
}

export interface SyncOptions {
  appVersion: string
  author: string
  /** Первое подключение устройства к облаку, где уже есть дневник, при своих данных на устройстве. */
  firstConnect?: 'merge' | 'replace'
  onProgress?: (text: string) => void
  /** Снимок в облаке не чаще этого интервала (по умолчанию сутки). */
  snapshotIntervalMs?: number
  now?: () => Date
}

export const MANIFEST = 'dachabook.json'
const META_KEY = 'syncMeta'
const SNAPSHOT_KEEP = 30
const FORMAT = 1
/** Запас для курсора: изменения, сделанные чуть раньше снимка, не теряются. */
const SNAPSHOT_OVERLAP_MS = 60 * 60 * 1000

export const docPath = (collection: string, id: string) => `docs/${collection}/${id}.json`
export const docText = (doc: unknown) => JSON.stringify(doc, null, 2)
export const textMd5 = (text: string) => SparkMD5.hash(text)
const fileExtension = (name: string) => name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0].toLowerCase() ?? ''
export const originalPath = (file: Pick<StoredFile, 'id' | 'fileName'>) => `files/originals/${file.id}${fileExtension(file.fileName)}`
export const thumbPath = (id: string) => `files/thumbs/${id}.jpg`

export async function readSyncMeta(database: DiaryDatabase): Promise<SyncMeta | undefined> {
  return (await database.settings.get(META_KEY))?.value as SyncMeta | undefined
}

async function writeSyncMeta(database: DiaryDatabase, meta: SyncMeta): Promise<void> {
  await database.settings.put({ key: META_KEY, value: meta })
}

export async function forgetSync(database: DiaryDatabase): Promise<void> {
  await database.transaction('rw', database.settings, database.syncState, database.conflicts, async () => {
    await database.settings.delete(META_KEY)
    await database.syncState.clear()
    await database.conflicts.clear()
  })
}

async function readJson<T>(cloud: CloudAdapter, path: string): Promise<T | null> {
  const blob = await cloud.read(path)
  return blob ? (JSON.parse(await blob.text()) as T) : null
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++])
    }),
  )
}

const isTombstone = (doc: unknown): doc is Tombstone => !!doc && typeof doc === 'object' && 'purgedAt' in doc

/** Записи, которые есть на устройстве, кроме стартовых примет: от этого зависит вопрос «объединить или взять из облака». */
export async function localDataCount(database: DiaryDatabase): Promise<number> {
  let count = 0
  for (const name of DOC_TABLES) count += await database.table(name).filter((doc: Doc) => doc.createdBy !== 'DachaBook').count()
  return count
}

type Outcome = 'added' | 'updated' | 'same' | 'kept' | 'conflict' | 'purged' | 'corrupted'

/**
 * Входящая из облака версия записи. Локальная не менялась с последней синхронизации — принимается облачная;
 * изменены обе — конфликт, обе версии сохраняются до решения пользователя.
 */
export async function applyRemote(database: DiaryDatabase, collection: Collection, remote: Doc | Tombstone, md5: string): Promise<Outcome> {
  const key = `${collection}/${remote.id}`
  const table = database.table(collection)
  // Контрольная сумма считается до транзакции: внешние асинхронные операции внутри неё закрывают её раньше времени.
  const intact = isTombstone(remote) || (await verifyChecksum(remote))
  return database.transaction('rw', table, database.syncState, database.conflicts, database.fileContents, async () => {
    const local = (await table.get(remote.id)) as Doc | undefined
    const state = await database.syncState.get(key)
    const dirty = !!local && local.revision !== state?.revision
    const conflict = async () => {
      const existing = await database.conflicts.where('key').equals(key).first()
      await database.conflicts.put({
        id: existing?.id ?? crypto.randomUUID(),
        key,
        collection,
        docId: remote.id,
        local: local!,
        remote: remote as unknown as Record<string, unknown>,
        remoteMd5: md5,
        detectedAt: new Date().toISOString(),
      } satisfies ConflictRecord)
      await database.syncState.put({ ...state, key, remoteMd5: md5 })
      return 'conflict' as const
    }

    if (isTombstone(remote)) {
      if (dirty && state) return conflict()
      if (local) await table.delete(remote.id)
      if (collection === 'files') await database.fileContents.delete(remote.id)
      await database.syncState.put({ key, revision: remote.revision, remoteMd5: md5, purged: true })
      return 'purged'
    }
    if (!intact) return 'corrupted'
    const accept = async (outcome: Outcome) => {
      await table.put(remote)
      await database.syncState.put({ ...state, key, revision: remote.revision, remoteMd5: md5, purged: false, tombstonePending: false })
      await database.conflicts.where('key').equals(key).delete()
      return outcome
    }
    // Нет локально: новая запись или удалённая здесь окончательно, но изменённая на другом устройстве (обе версии не теряются).
    if (!local) return accept('added')
    if (local.revision === remote.revision) return accept('same')
    if (!dirty) return accept('updated')
    if (remote.revision === state?.revision || local.baseRevision === remote.revision) {
      await database.syncState.put({ ...state, key, revision: remote.revision, remoteMd5: md5 })
      return 'kept'
    }
    if (remote.baseRevision === local.revision) return accept('updated')
    if (local.checksum === remote.checksum && !local.deletedAt === !remote.deletedAt) return accept('same')
    return conflict()
  })
}

async function ensureLayout(cloud: CloudAdapter): Promise<void> {
  await cloud.ensureFolder('')
  for (const name of DOC_TABLES) await cloud.ensureFolder(`docs/${name}`)
  await cloud.ensureFolder('files/originals')
  await cloud.ensureFolder('files/thumbs')
  await cloud.ensureFolder('snapshots')
}

/** Снимок облака на устройство: записи и уменьшенные копии из одного архива вместо тысяч отдельных файлов. */
async function applySnapshot(database: DiaryDatabase, cloud: CloudAdapter, path: string, result: SyncResult): Promise<boolean> {
  const blob = await cloud.read(path)
  if (!blob) return false
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  for (const [name, bytes] of Object.entries(entries)) {
    const match = name.match(/^([A-Za-z]+)\/(?:\d{4}\/)?[0-9a-f-]{36}\.json$/)
    if (!match || !(DOC_TABLES as readonly string[]).includes(match[1])) continue
    const text = strFromU8(bytes)
    const outcome = await applyRemote(database, match[1] as Collection, JSON.parse(text) as Doc, textMd5(text))
    if (outcome === 'added' || outcome === 'updated') result.pulled++
    if (outcome === 'conflict') result.conflicts++
    if (outcome === 'corrupted') result.errors.push(`Повреждена запись в снимке: ${name}`)
  }
  for (const [name, bytes] of Object.entries(entries)) {
    const thumb = name.match(/^files\/thumbs\/([0-9a-f-]{36})\.jpg$/)
    if (!thumb) continue
    const existing = await database.fileContents.get(thumb[1])
    if (!existing?.thumb) await database.fileContents.put({ ...existing, id: thumb[1], thumb: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }) })
    await database.syncState.put({ ...(await database.syncState.get(`blob/${thumb[1]}`)), key: `blob/${thumb[1]}`, thumbUploaded: true })
  }
  return true
}

async function pull(database: DiaryDatabase, cloud: CloudAdapter, meta: SyncMeta, result: SyncResult, report: (text: string) => void): Promise<Map<string, Map<string, string | undefined>>> {
  const listed = new Map<string, Map<string, string | undefined>>()
  for (const collection of DOC_TABLES) {
    const { entries, cursor, complete } = await cloud.listChanges(`docs/${collection}`, meta.cursors[collection])
    if (complete) listed.set(collection, new Map(entries.map((entry) => [entry.path, entry.md5])))
    const keys = entries.map((entry) => `${collection}/${entry.name.replace(/\.json$/, '')}`)
    const states = await database.syncState.bulkGet(keys)
    const changed = entries.filter((entry, index) => !entry.md5 || states[index]?.remoteMd5 !== entry.md5)
    let done = 0
    await pool(changed, 4, async (entry: RemoteEntry) => {
      const blob = await cloud.read(entry.path)
      if (!blob) return
      const text = await blob.text()
      const outcome = await applyRemote(database, collection, JSON.parse(text) as Doc, entry.md5 ?? textMd5(text))
      if (outcome === 'added' || outcome === 'updated' || outcome === 'purged') result.pulled++
      if (outcome === 'conflict') result.conflicts++
      if (outcome === 'corrupted') result.errors.push(`Повреждена запись в облаке: ${entry.path}`)
      if (++done % 20 === 0) report(`Получение: ${collection}, ${done} из ${changed.length}`)
    })
    if (cursor) meta.cursors[collection] = cursor
  }
  return listed
}

/** Окончательное удаление: запись исчезает на устройстве, в облако при синхронизации уходит надгробие. */
export async function purgeDoc(database: DiaryDatabase, collection: Collection, id: string): Promise<void> {
  const key = `${collection}/${id}`
  await database.transaction('rw', database.table(collection), database.syncState, database.fileContents, database.conflicts, async () => {
    const state = await database.syncState.get(key)
    await database.table(collection).delete(id)
    if (collection === 'files') await database.fileContents.delete(id)
    await database.conflicts.where('key').equals(key).delete()
    await database.syncState.put({ ...state, key, purged: true, tombstonePending: true } satisfies SyncRecord)
  })
}

async function pushTombstones(database: DiaryDatabase, cloud: CloudAdapter, author: string, result: SyncResult): Promise<void> {
  for (const state of await database.syncState.filter((item) => !!item.tombstonePending).toArray()) {
    const [collection, id] = state.key.split('/') as [Collection, string]
    const path = docPath(collection, id)
    const remote = await cloud.stat(path)
    if (remote && state.remoteMd5 && remote.md5 !== state.remoteMd5) {
      // Запись изменили на другом устройстве после удаления здесь — она возвращается, а не удаляется.
      const blob = await cloud.read(path)
      if (blob) {
        const text = await blob.text()
        await applyRemote(database, collection, JSON.parse(text) as Doc, remote.md5 ?? textMd5(text))
        continue
      }
    }
    const tombstone: Tombstone = { id, revision: crypto.randomUUID(), purgedAt: new Date().toISOString(), purgedBy: author }
    const text = docText(tombstone)
    await cloud.write(path, new Blob([text], { type: 'application/json' }))
    await database.syncState.put({ ...state, revision: tombstone.revision, remoteMd5: textMd5(text), tombstonePending: false })
    result.pushed++
  }
}

async function push(database: DiaryDatabase, cloud: CloudAdapter, listed: Map<string, Map<string, string | undefined>>, result: SyncResult, report: (text: string) => void): Promise<void> {
  const conflicted = new Set((await database.conflicts.toArray()).map((item) => item.key))
  for (const collection of DOC_TABLES) {
    const docs = (await database.table(collection).toArray()) as Doc[]
    const states = await database.syncState.bulkGet(docs.map((doc) => `${collection}/${doc.id}`))
    const dirty = docs.filter((doc, index) => doc.revision !== states[index]?.revision && !conflicted.has(`${collection}/${doc.id}`))
    let done = 0
    await pool(dirty, 4, async (doc) => {
      const key = `${collection}/${doc.id}`
      const path = docPath(collection, doc.id)
      const state = await database.syncState.get(key)
      const known = listed.get(collection)
      const remote = known ? (known.has(path) ? { md5: known.get(path) } : null) : await cloud.stat(path)
      if (remote && remote.md5 !== state?.remoteMd5) {
        // В облаке появилась другая версия: сначала получить её, отправлять только если она старше локальной.
        const blob = await cloud.read(path)
        if (blob) {
          const text = await blob.text()
          const outcome = await applyRemote(database, collection, JSON.parse(text) as Doc, remote.md5 ?? textMd5(text))
          if (outcome === 'conflict') result.conflicts++
          if (outcome !== 'kept') return
        }
      }
      const current = (await database.table(collection).get(doc.id)) as Doc | undefined
      if (!current) return
      const text = docText(current)
      await cloud.write(path, new Blob([text], { type: 'application/json' }))
      await database.syncState.put({ ...(await database.syncState.get(key)), key, revision: current.revision, remoteMd5: textMd5(text), purged: false })
      result.pushed++
      if (++done % 20 === 0) report(`Отправка: ${collection}, ${done} из ${dirty.length}`)
    })
  }
}

/** Оригиналы и уменьшенные копии: отправка новых и получение уменьшенных копий, которых нет на устройстве. */
async function syncFiles(database: DiaryDatabase, cloud: CloudAdapter, result: SyncResult, report: (text: string) => void): Promise<void> {
  const files = ((await database.files.toArray()) as StoredFile[]).filter((file) => !file.deletedAt)
  let done = 0
  await pool(files, 3, async (file) => {
    const key = `blob/${file.id}`
    const state = (await database.syncState.get(key)) ?? { key }
    const content = await database.fileContents.get(file.id)
    if (content?.original && !state.originalUploaded) {
      await cloud.write(originalPath(file), content.original)
      state.originalUploaded = true
      result.uploadedFiles++
    }
    if (content?.thumb && !state.thumbUploaded) {
      await cloud.write(thumbPath(file.id), content.thumb)
      state.thumbUploaded = true
    }
    if (!content?.thumb && file.role === 'photo') {
      const thumb = await cloud.read(thumbPath(file.id))
      if (thumb) {
        await database.fileContents.put({ ...content, id: file.id, thumb: new Blob([thumb], { type: 'image/jpeg' }) })
        state.thumbUploaded = true
        result.thumbs++
      }
    }
    await database.syncState.put(state)
    if (++done % 20 === 0) report(`Фото и файлы: ${done} из ${files.length}`)
  })
}

/** Оригинал, которого нет на устройстве, скачивается из облака при открытии и остаётся на устройстве. */
export async function fetchOriginal(database: DiaryDatabase, cloud: CloudAdapter, file: StoredFile): Promise<Blob | null> {
  const blob = await cloud.read(originalPath(file))
  if (!blob) return null
  const original = new Blob([blob], { type: file.mime })
  const content = await database.fileContents.get(file.id)
  await database.fileContents.put({ ...content, id: file.id, original })
  await database.syncState.put({ ...(await database.syncState.get(`blob/${file.id}`)), key: `blob/${file.id}`, originalUploaded: true })
  return original
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)

/** Снимок в облаке: версия всех записей на сегодня и быстрый старт нового устройства; хранятся 30 последних. */
export async function uploadSnapshot(database: DiaryDatabase, cloud: CloudAdapter, manifest: DiaryManifest, options: SyncOptions): Promise<DiaryManifest> {
  const now = options.now?.() ?? new Date()
  const { blob } = await buildBackup(database, options.appVersion, { originals: false })
  const path = `snapshots/dachabook-snapshot-${stamp(now)}.zip`
  await cloud.write(path, blob)
  const next = { ...manifest, snapshot: { path, at: now.toISOString() } }
  await cloud.write(MANIFEST, new Blob([docText(next)], { type: 'application/json' }))
  const snapshots = (await cloud.list('snapshots')).filter((entry) => /^dachabook-snapshot-.*\.zip$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name))
  for (const old of snapshots.slice(SNAPSHOT_KEEP)) await cloud.remove(old.path)
  return next
}

/** Записи, ещё не отправленные в облако (включая неразрешённые конфликты). */
export async function pendingCount(database: DiaryDatabase): Promise<number> {
  let count = 0
  for (const collection of DOC_TABLES) {
    const docs = (await database.table(collection).toArray()) as Doc[]
    const states = await database.syncState.bulkGet(docs.map((doc) => `${collection}/${doc.id}`))
    count += docs.filter((doc, index) => doc.revision !== states[index]?.revision).length
  }
  return count
}

/** Одна синхронизация: описание дневника → (первое подключение — снимок) → получение → отправка → файлы → снимок раз в сутки. */
export async function synchronize(database: DiaryDatabase, cloud: CloudAdapter, options: SyncOptions): Promise<SyncResult> {
  const report = options.onProgress ?? (() => undefined)
  const now = () => options.now?.() ?? new Date()
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, thumbs: 0, uploadedFiles: 0, bootstrapped: false, errors: [] }

  report('Проверка облака…')
  await ensureLayout(cloud)
  let manifest = await readJson<DiaryManifest>(cloud, MANIFEST)
  let meta = await readSyncMeta(database)
  if (manifest && manifest.app !== 'dachabook') throw new Error('В папке облака лежит не дневник DachaBook')
  if (manifest && manifest.format > FORMAT) throw new Error('Дневник в облаке создан более новой версией DachaBook. Обновите приложение')
  if (meta && manifest && meta.diaryId !== manifest.diaryId) throw new Error('В облаке другой дневник, чем был подключён к этому устройству. Отключите облако и подключите заново')
  if (meta && !manifest) throw new Error('В облаке пропал файл дневника dachabook.json. Синхронизация остановлена, чтобы не создать второй дневник')

  if (!manifest) {
    manifest = { app: 'dachabook', format: FORMAT, diaryId: crypto.randomUUID(), createdAt: now().toISOString() }
    await cloud.write(MANIFEST, new Blob([docText(manifest)], { type: 'application/json' }))
  }
  if (!meta) {
    meta = { diaryId: manifest.diaryId, cursors: {} }
    if (options.firstConnect === 'replace') {
      await createSnapshot(database, 'Перед заменой данными из облака')
      await database.transaction('rw', [...DOC_TABLES.map((name) => database.table(name)), database.fileContents], async () => {
        for (const name of DOC_TABLES) await database.table(name).clear()
        await database.fileContents.clear()
      })
    }
    if (manifest.snapshot) {
      report('Загрузка снимка дневника…')
      result.bootstrapped = await applySnapshot(database, cloud, manifest.snapshot.path, result)
      if (result.bootstrapped) {
        const since = new Date(Date.parse(manifest.snapshot.at) - SNAPSHOT_OVERLAP_MS).toISOString()
        for (const name of DOC_TABLES) meta.cursors[name] = since
      }
    }
  }

  report('Получение изменений…')
  const listed = await pull(database, cloud, meta, result, report)
  await writeSyncMeta(database, meta)
  report('Отправка изменений…')
  await push(database, cloud, listed, result, report)
  await pushTombstones(database, cloud, options.author, result)
  report('Фото и файлы…')
  await syncFiles(database, cloud, result, report)

  const interval = options.snapshotIntervalMs ?? 24 * 60 * 60 * 1000
  if (result.pushed > 0 && (!manifest.snapshot || now().getTime() - Date.parse(manifest.snapshot.at) >= interval)) {
    report('Снимок дневника в облаке…')
    await uploadSnapshot(database, cloud, manifest, options)
  }
  meta.lastSuccessAt = now().toISOString()
  await writeSyncMeta(database, meta)
  report('Готово')
  return result
}
