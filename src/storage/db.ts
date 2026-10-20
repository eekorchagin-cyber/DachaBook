import Dexie, { type EntityTable } from 'dexie'
import type {
  CareObject,
  DiaryEvent,
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

export class DiaryDatabase extends Dexie {
  objects!: EntityTable<CareObject, 'id'>
  plantGroups!: EntityTable<PlantGroup, 'id'>
  events!: EntityTable<DiaryEvent, 'id'>
  files!: EntityTable<StoredFile, 'id'>
  fileContents!: EntityTable<FileContent, 'id'>
  references!: EntityTable<ReferenceMaterial, 'id'>
  planDrafts!: EntityTable<PlanDraftItem, 'id'>
  importArchive!: EntityTable<ImportArchiveItem, 'id'>
  settings!: EntityTable<SettingRow, 'key'>

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
  }
}

export const db = new DiaryDatabase()
