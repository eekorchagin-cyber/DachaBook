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

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'thunderstorm'

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
  /** Дата и час, для которых получены данные: при смене даты или времени записи погода запрашивается заново. */
  forDate?: string
  forTime?: string
  /** Осадки и облачность значком на карточке записи. */
  condition?: WeatherCondition
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
  /** Пояснения к фото и вложениям этой записи: идентификатор файла → текст. */
  fileNotes?: Record<string, string>
  weather?: WeatherSnapshot
  /** Плановая работа, выполнение которой отмечено этой записью. */
  planWorkId?: string
  /** Эту работу больше не предлагать для плана. Сама запись дневника остаётся. */
  planSuggestionDismissed?: boolean
  /** Сколько расходных материалов ушло на работу; по этим данным планируются закупки. */
  consumables?: ConsumableUse[]
  source?: ImportSource
}

export interface ConsumableUse {
  consumableId: string
  quantity: number
}

/** Расходный материал для ухода за участком: удобрение, средство защиты, семена, мульча. */
export interface Consumable extends DocMeta {
  name: string
  /** Единица учёта: кг, л, шт. Расход в записях дневника указывается в ней же. */
  unit: string
  /** Сколько нужно на сезон; основа для планирования закупок. */
  seasonQuantity?: number
  objectIds: string[]
  /** Что это за материал и для чего он. */
  description?: string
  /** Страница в интернете: инструкция производителя, магазин. */
  url?: string
  note?: string
  active: boolean
}

/** Народная примета или совет на день года (без привязки к году). */
export interface FolkSign extends DocMeta {
  month: number
  day: number
  title: string
  text: string
  source?: { title: string; url?: string }
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

/**
 * Условие готовности, привязанное к заморозкам (раздел 4 ТЗ): «до первых осенних заморозков за N дней»
 * или «после весенних заморозков — в ближайший выбранный день недели». Порог — минимальная температура воздуха за сутки.
 */
export type WorkCondition =
  | { type: 'beforeAutumnFrost'; leadDays: number; thresholdC?: number }
  | { type: 'afterSpringFrost'; weekday?: number; calmDays?: number; thresholdC?: number }

/** Состояние работы в одном сезоне (год): выполнена, перенесена или пропущена. Нет записи — работа ещё не отмечена. */
export interface WorkSeason {
  status: 'done' | 'postponed' | 'skipped'
  /** Дата выполнения или новая дата после переноса. */
  date?: string
  eventId?: string
}

/**
 * Повтор внутри сезона, каждый год в том же окне дат.
 * Либо дни недели, либо шаг в неделях от первого дня окна — одновременно не оба.
 * Время суток — подпись, когда работу удобно делать; напоминание в этот час не приходит.
 */
export interface SeasonSchedule {
  fromMonth: number
  fromDay: number
  toMonth: number
  toDay: number
  /** 1 — каждую неделю, 2 — раз в две недели. Пусто, если заданы дни недели. */
  everyWeeks?: number
  /** 1 — понедельник … 7 — воскресенье. */
  weekdays?: number[]
  timeFrom?: string
  timeTo?: string
}

/** Плановая работа: каждый год, один раз или по расписанию внутри сезона. */
export interface PlanWork extends DocMeta {
  title: string
  workKind?: string
  objectIds: string[]
  plantGroupIds: string[]
  note?: string
  recurrence: 'yearly' | 'once' | 'season'
  /** Ориентир по календарю: месяцы и недели; пусто — срок задаёт условие или расписание сезона. */
  periods: PlanPeriod[]
  condition?: WorkCondition
  /** Окно и шаг повтора, если recurrence равен season. */
  seasonSchedule?: SeasonSchedule
  /** Даты короткой отметки «сделано» без записи в дневнике. */
  doneDates?: string[]
  /** Слова для поиска таких работ в дневнике прошлых лет (например, «водопровод» и «слил»). */
  historyWords?: string[][]
  sourceDraftId?: string
  seasons: Record<string, WorkSeason>
  active: boolean
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
  consumables: Consumable
  folkSigns: FolkSign
  planWorks: PlanWork
}

export type CollectionName = keyof Collections

export type DocInput<T extends DocMeta> = Omit<T, MetaKey> & { id?: string }
