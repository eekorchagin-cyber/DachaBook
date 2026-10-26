import Dexie, { type EntityTable } from 'dexie'
import type {
  CareObject,
  Consumable,
  DiaryEvent,
  FolkSign,
  ImportArchiveItem,
  PlanDraftItem,
  PlanWork,
  PlantGroup,
  ReferenceMaterial,
  StoredFile,
} from '../domain/types'

export interface FileContent {
  id: string
  original?: Blob
  thumb?: Blob
}

export interface SettingRow {
  key: string
  value: unknown
}

/** Что облако знает о записи: ревизия и md5 её файла; для файлов — отправлены ли оригинал и уменьшенная копия. */
export interface SyncRecord {
  key: string
  revision?: string
  remoteMd5?: string
  purged?: boolean
  /** Запись окончательно удалена здесь, надгробие ещё не отправлено в облако. */
  tombstonePending?: boolean
  originalUploaded?: boolean
  thumbUploaded?: boolean
  /** Когда уменьшенной копии не оказалось в облаке (например, HEIC без миниатюры): повтор не чаще раза в сутки. */
  thumbMissingAt?: string
}

/** Запись, изменённая и здесь, и в облаке: обе версии хранятся до решения пользователя. */
export interface ConflictRecord {
  id: string
  key: string
  collection: string
  docId: string
  local: Record<string, unknown>
  remote: Record<string, unknown>
  remoteMd5: string
  detectedAt: string
}

/** Снимок документов перед массовыми изменениями (импорт); файлы не дублируются — импорт их не меняет. */
export interface Snapshot {
  id: string
  createdAt: string
  reason: string
  counts: Record<string, number>
  data: Record<string, unknown[]>
}

export class DiaryDatabase extends Dexie {
  objects!: EntityTable<CareObject, 'id'>
  plantGroups!: EntityTable<PlantGroup, 'id'>
  events!: EntityTable<DiaryEvent, 'id'>
  files!: EntityTable<StoredFile, 'id'>
  fileContents!: EntityTable<FileContent, 'id'>
  references!: EntityTable<ReferenceMaterial, 'id'>
  planDrafts!: EntityTable<PlanDraftItem, 'id'>
  importArchive!: EntityTable<ImportArchiveItem, 'id'>
  consumables!: EntityTable<Consumable, 'id'>
  folkSigns!: EntityTable<FolkSign, 'id'>
  planWorks!: EntityTable<PlanWork, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  snapshots!: EntityTable<Snapshot, 'id'>
  syncState!: EntityTable<SyncRecord, 'key'>
  conflicts!: EntityTable<ConflictRecord, 'id'>

  constructor(name = 'dachabook') {
    super(name)
    this.version(1).stores({
      objects: 'id, type, active, deletedAt',
      plantGroups: 'id, active, deletedAt',
      events: 'id, date, type, workKind, deletedAt, *objectIds, *plantGroupIds',
      files: 'id, role, sha256, uploadState, deletedAt',
      fileContents: 'id',
      references: 'id, title, deletedAt, *tags',
      planDrafts: 'id, itemType, deletedAt',
      importArchive: 'id, sourceFileId, fingerprint, deletedAt',
      settings: 'key',
    })
    this.version(2).stores({ snapshots: 'id, createdAt' })
    this.version(3).stores({ consumables: 'id, name, active, deletedAt', folkSigns: 'id, month, deletedAt' })
    this.version(4).stores({ syncState: 'key', conflicts: 'id, &key' })
    this.version(5).stores({ planWorks: 'id, active, deletedAt' })
  }
}

/** Таблицы документов: всё, что входит в резервную копию и меняется пользователем. */
export const DOC_TABLES = ['objects', 'plantGroups', 'events', 'files', 'references', 'planDrafts', 'importArchive', 'consumables', 'folkSigns', 'planWorks'] as const

export const db = new DiaryDatabase()
