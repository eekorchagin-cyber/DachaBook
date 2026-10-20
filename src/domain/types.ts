export const SCHEMA_VERSION = 1

/** Служебные поля каждого документа (раздел 7 ТЗ). */
export interface DocMeta {
  id: string
  schemaVersion: number
  /** UUID редакции; меняется при каждом сохранении. */
  revision: string
  /** Редакция, от которой сделана правка; по ней, а не по времени, определяется конфликт. */
  baseRevision?: string
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  /** Время перемещения в корзину. */
  deletedAt?: string
  /** SHA-256 содержимого документа без служебных полей. */
  checksum: string
}

export type MetaKey = keyof DocMeta

export type ObjectType = 'lawn' | 'garden' | 'beds' | 'plants' | 'place'

export interface CareObject extends DocMeta {
  name: string
  type: ObjectType
  location?: string
  areaM2?: number
  plantCount?: number
  description?: string
  active: boolean
}

export interface PlantGroup extends DocMeta {
  name: string
  objectIds: string[]
  description?: string
  active: boolean
}

export type EventType = 'work' | 'observation' | 'measurement'

export interface Measurement {
  temperature?: { value: number; unit: '°C' }
  /** Влажность поверхности почвы в исходной шкале прибора; без пересчёта между шкалами. */
  moisture?: { value: number; scale: string }
}

/** Откуда взята импортированная запись (раздел 3 ТЗ, «Сведения об источнике»). */
export interface ImportSource {
  app: 'evernote'
  archiveItemIds: string[]
  files: string[]
  fingerprint: string
}

/**
 * Погода на участке в момент события (раздел 4 ТЗ). Заполняется на этапе 4 из Open-Meteo и потом не переписывается.
 * Архив погодного сервиса — модельная оценка, а не измерение на участке.
 */
export interface WeatherSnapshot {
  source: string
  kind: 'forecast' | 'archive' | 'manual'
  latitude: number
  longitude: number
  fetchedAt: string
  /** За час события или суточная сводка, если время события не указано. */
  period: 'hour' | 'day'
  airTemperature?: number
  airTemperatureMin?: number
  airTemperatureMax?: number
  precipitationMm?: number
  humidityPercent?: number
  windMs?: number
}

export interface DiaryEvent extends DocMeta {
  type: EventType
  /** Дата события ГГГГ-ММ-ДД в часовом поясе участка; отличается от даты создания записи. */
  date: string
  time?: string
  objectIds: string[]
  plantGroupIds: string[]
  workKind?: string
  comment: string
  photoIds: string[]
  attachmentIds: string[]
  measurement?: Measurement
  weather?: WeatherSnapshot
  source?: ImportSource
}

export type UploadState = 'local' | 'pending' | 'uploading' | 'uploaded' | 'error'

/** Метаданные файла; содержимое лежит отдельно в таблице files. */
export interface StoredFile extends DocMeta {
  role: 'photo' | 'attachment'
  fileName: string
  mime: string
  size: number
  sha256: string
  width?: number
  height?: number
  thumbWidth?: number
  thumbHeight?: number
  uploadState: UploadState
}

export interface ReferenceMaterial extends DocMeta {
  title: string
  /** Очищенная разметка: заголовки, списки, таблицы, ссылки, изображения. */
  html: string
  tags: string[]
  objectIds: string[]
  plantGroupIds: string[]
  fileIds: string[]
  source?: ImportSource
}

export interface PlanPeriod {
  month: number
  week?: number
}

export interface PlanDraftItem extends DocMeta {
  itemType: 'work' | 'observation'
  periods: PlanPeriod[]
  text: string
  objectIds: string[]
  plantGroupIds: string[]
  fileIds: string[]
  /** Сезоны, в которых работа отмечена выполненной (из флажков Evernote или вручную). */
  seasonsDone: number[]
  transferred: boolean
  source?: ImportSource
}

export interface ImportArchiveItem extends DocMeta {
  sourceFileId: string
  sourceFileName: string
  noteTitle: string
  kind: 'note' | 'row' | 'outside-table'
  month?: number
  week?: string
  text: string
  rawDate?: string
  checkbox?: 'checked' | 'unchecked' | 'none'
  fingerprint: string
  createdRecordIds: string[]
}

export interface Collections {
  objects: CareObject
  plantGroups: PlantGroup
  events: DiaryEvent
  files: StoredFile
  references: ReferenceMaterial
  planDrafts: PlanDraftItem
  importArchive: ImportArchiveItem
}

export type CollectionName = keyof Collections

export type DocInput<T extends DocMeta> = Omit<T, MetaKey> & { id?: string }
