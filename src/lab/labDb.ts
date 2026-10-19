import Dexie, { type EntityTable } from 'dexie'

export interface LabDoc {
  id: string
  schemaVersion: number
  revision: string
  updatedAt: string
  body: string
  checksum: string
}

export interface LabBlob {
  id: string
  kind: 'random' | 'photo-original' | 'photo-thumb' | 'enex-resource'
  name: string
  type: string
  size: number
  sha256: string
  data: Blob
  createdAt: string
}

export interface LabMeta {
  key: string
  value: string
}

/** Отдельная база для проверок этапа 1, чтобы не смешивать её с данными дневника. */
class LabDatabase extends Dexie {
  docs!: EntityTable<LabDoc, 'id'>
  blobs!: EntityTable<LabBlob, 'id'>
  meta!: EntityTable<LabMeta, 'key'>

  constructor() {
    super('dachabook-lab')
    this.version(1).stores({
      docs: 'id, updatedAt',
      blobs: 'id, kind, createdAt',
      meta: 'key',
    })
  }
}

export const labDb = new LabDatabase()
