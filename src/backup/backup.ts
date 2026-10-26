import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { DEFAULT_SETTINGS, type AppSettings } from '../app/store'
import { mergeItems } from '../domain/dictionaries'
import { SCHEMA_VERSION, type DocMeta, type StoredFile } from '../domain/types'
import type { DiaryDatabase } from '../storage/db'
import { verifyChecksum } from '../storage/repository'
import { createSnapshot } from '../storage/snapshots'

export const BACKUP_FORMAT = 1

const COLLECTIONS = ['objects', 'plantGroups', 'events', 'references', 'planDrafts', 'importArchive', 'consumables', 'folkSigns', 'planWorks', 'files'] as const
type Collection = (typeof COLLECTIONS)[number]

export interface BackupManifest {
  app: 'dachabook'
  format: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  counts: Record<string, number>
  /** Полная копия — только если в ней есть оригиналы всех файлов (раздел 7 ТЗ). */
  complete: boolean
  missingOriginals: string[]
}

const README = `Резервная копия DachaBook — дневника дачных работ и наблюдений.

manifest.json — описание копии: версия формата, версия схемы данных, дата, число записей, полнота.
objects/, plantGroups/ — объекты ухода и группы растений, по одному JSON-файлу (UTF-8) на запись.
events/ГГГГ/ — записи дневника по годам даты события.
references/ — статьи (HTML в поле html).
planDrafts/ — черновик сезонного плана.
importArchive/ — архив импорта: исходные строки и заметки Evernote.
consumables/ — расходные материалы; расход по работам — в записях дневника (поле consumables).
folkSigns/ — народные приметы по дням года.
planWorks/ — плановые работы: сроки, условия, отметки о выполнении по сезонам.
files/ — описания фото и вложений; files/originals/ — оригиналы без изменений; files/thumbs/ — уменьшенные копии.
settings/shared.json — общие настройки дневника (справочники видов работ и единиц, адрес и координаты участка).

У каждой записи: id (UUID), schemaVersion, revision (UUID редакции), baseRevision, createdAt/updatedAt, createdBy/updatedBy,
deletedAt (если в корзине) и checksum — SHA-256 содержимого без служебных полей.
Пароли, токены и личные настройки устройства в копию не входят.
`

const SHARED_SETTINGS = ['workKinds', 'workKindRenames', 'consumableUnits', 'plotAddress', 'plotLocation']

function extension(fileName: string): string {
  const match = fileName.match(/\.[A-Za-z0-9]{1,8}$/)
  return match ? match[0].toLowerCase() : ''
}

function docPath(collection: Collection, doc: DocMeta & { date?: string }): string {
  if (collection === 'events' && doc.date) return `events/${doc.date.slice(0, 4)}/${doc.id}.json`
  return `${collection}/${doc.id}.json`
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/** Полная резервная копия: каждая запись — отдельный JSON, файлы — отдельно, без личных настроек и секретов. */
/** originals: false — снимок для облака: оригиналы там лежат отдельными файлами, копия всё равно отмечается неполной. */
export async function buildBackup(
  database: DiaryDatabase,
  appVersion: string,
  options: { originals?: boolean } = {},
): Promise<{ blob: Blob; fileName: string; manifest: BackupManifest }> {
  const withOriginals = options.originals ?? true
  const entries: Zippable = {}
  const counts: Record<string, number> = {}
  const missingOriginals: string[] = []

  for (const collection of COLLECTIONS) {
    const docs = (await database.table(collection).toArray()) as (DocMeta & { date?: string })[]
    counts[collection] = docs.length
    for (const doc of docs) entries[docPath(collection, doc)] = [strToU8(JSON.stringify(doc, null, 2)), { level: 6 }]
  }

  for (const file of (await database.files.toArray()) as StoredFile[]) {
    const content = await database.fileContents.get(file.id)
    if (withOriginals && content?.original) entries[`files/originals/${file.id}${extension(file.fileName)}`] = [new Uint8Array(await content.original.arrayBuffer()), { level: 0 }]
    else missingOriginals.push(file.id)
    if (content?.thumb) entries[`files/thumbs/${file.id}.jpg`] = [new Uint8Array(await content.thumb.arrayBuffer()), { level: 0 }]
  }

  const shared: Record<string, unknown> = {}
  for (const key of SHARED_SETTINGS) {
    const value = (await database.settings.get(key))?.value
    if (value) shared[key] = value
  }
  if (Object.keys(shared).length > 0) entries['settings/shared.json'] = strToU8(JSON.stringify(shared, null, 2))

  const now = new Date()
  const manifest: BackupManifest = {
    app: 'dachabook',
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    counts,
    complete: missingOriginals.length === 0,
    missingOriginals,
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  entries['README.txt'] = strToU8(README)
  const zipped = zipSync(entries)
  return { blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), fileName: `dachabook-backup-${stamp(now)}.zip`, manifest }
}

export interface RestoreResult {
  snapshotId: string
  manifest: BackupManifest
  added: number
  updated: number
  same: number
  keptLocal: number
  files: number
  conflicts: string[]
  corrupted: string[]
}

function title(doc: Record<string, unknown>): string {
  const value = (doc.title ?? doc.name ?? doc.comment ?? doc.text ?? doc.fileName ?? doc.id) as string
  return String(value).slice(0, 60)
}

/**
 * Импорт копии с объединением: новые записи добавляются, одинаковые пропускаются, ничего не удаляется.
 * Если запись по-разному изменена здесь и в копии, остаётся местная версия, а расхождение попадает в отчёт.
 */
export async function restoreBackup(database: DiaryDatabase, data: ArrayBuffer): Promise<RestoreResult> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(data))
  } catch {
    throw new Error('Файл не похож на резервную копию DachaBook: это не ZIP-архив или он повреждён')
  }
  const manifestData = entries['manifest.json']
  const manifest = manifestData ? (JSON.parse(strFromU8(manifestData)) as BackupManifest) : null
  if (!manifest || manifest.app !== 'dachabook') throw new Error('В архиве нет описания копии DachaBook (manifest.json)')
  if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Копия создана более новой версией DachaBook. Обновите приложение и повторите импорт — сейчас ничего не изменено')
  }

  const snapshotId = await createSnapshot(database, 'Перед импортом резервной копии')
  const result: RestoreResult = { snapshotId, manifest, added: 0, updated: 0, same: 0, keptLocal: 0, files: 0, conflicts: [], corrupted: [] }

  const originals = new Map<string, Uint8Array>()
  const thumbs = new Map<string, Uint8Array>()
  for (const [path, bytes] of Object.entries(entries)) {
    const original = path.match(/^files\/originals\/([0-9a-f-]{36})/)
    if (original) originals.set(original[1], bytes)
    const thumb = path.match(/^files\/thumbs\/([0-9a-f-]{36})/)
    if (thumb) thumbs.set(thumb[1], bytes)
  }

  for (const collection of COLLECTIONS) {
    const table = database.table(collection)
    for (const [path, bytes] of Object.entries(entries)) {
      if (!path.startsWith(`${collection}/`) || !path.endsWith('.json') || path.startsWith('files/originals/') || path.startsWith('files/thumbs/')) continue
      let incoming: DocMeta & Record<string, unknown>
      try {
        incoming = JSON.parse(strFromU8(bytes))
      } catch {
        result.corrupted.push(path)
        continue
      }
      if (!incoming.id || !(await verifyChecksum(incoming))) {
        result.corrupted.push(`${path} (${title(incoming)})`)
        continue
      }
      const local = (await table.get(incoming.id)) as (DocMeta & Record<string, unknown>) | undefined
      if (!local) {
        await table.put(incoming)
        result.added++
      } else if (local.revision === incoming.revision) {
        result.same++
      } else if (incoming.baseRevision === local.revision) {
        await table.put(incoming)
        result.updated++
      } else if (local.baseRevision === incoming.revision) {
        result.keptLocal++
      } else if (local.checksum === incoming.checksum && !local.deletedAt === !incoming.deletedAt) {
        // Одинаковые записи, созданные независимо (например, стартовые приметы на каждом устройстве).
        result.same++
      } else {
        result.conflicts.push(title(local))
      }

      if (collection === 'files') {
        const file = incoming as unknown as StoredFile
        const existing = await database.fileContents.get(file.id)
        if (!existing?.original && originals.has(file.id)) {
          await database.fileContents.put({
            id: file.id,
            original: new Blob([originals.get(file.id)! as Uint8Array<ArrayBuffer>], { type: file.mime }),
            thumb: thumbs.has(file.id) ? new Blob([thumbs.get(file.id)! as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }) : existing?.thumb,
          })
          result.files++
        }
      }
    }
  }

  const shared = entries['settings/shared.json']
  if (shared) {
    const incoming = JSON.parse(strFromU8(shared)) as Partial<Pick<AppSettings, 'workKinds' | 'workKindRenames' | 'consumableUnits' | 'plotAddress' | 'plotLocation'>>
    const local = async <K extends keyof AppSettings>(key: K) => ((await database.settings.get(key))?.value as AppSettings[K] | undefined) ?? DEFAULT_SETTINGS[key]
    if (incoming.plotAddress && !(await database.settings.get('plotAddress'))?.value) await database.settings.put({ key: 'plotAddress', value: incoming.plotAddress })
    if (incoming.plotLocation && !(await database.settings.get('plotLocation'))?.value) await database.settings.put({ key: 'plotLocation', value: incoming.plotLocation })
    for (const key of ['workKinds', 'consumableUnits'] as const) {
      const current = await local(key)
      const merged = mergeItems(current, incoming[key] ?? [])
      if (merged.length !== current.length) await database.settings.put({ key, value: merged })
    }
    if (incoming.workKindRenames) await database.settings.put({ key: 'workKindRenames', value: { ...incoming.workKindRenames, ...(await local('workKindRenames')) } })
  }
  return result
}
