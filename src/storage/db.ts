import Dexie, { type EntityTable } from 'dexie'
import type {
  CareObject,
  Consumable,
  DiaryEvent,
  FolkSign,
  ImportArchiveItem,
  PlanDraftItem,
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
  settings!: EntityTable<SettingRow, 'key'>
  snapshots!: EntityTable<Snapshot, 'id'>

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
  }
}

/** Таблицы документов: всё, что входит в резервную копию и меняется пользователем. */
export const DOC_TABLES = ['objects', 'plantGroups', 'events', 'files', 'references', 'planDrafts', 'importArchive', 'consumables', 'folkSigns'] as const

export const db = new DiaryDatabase()
