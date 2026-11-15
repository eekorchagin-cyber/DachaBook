import type { WeatherCondition, WeatherSnapshot } from '../../domain/types'

/** Запись в JSON-экспорте Day One. Лишние поля журнала здесь не нужны. */
export interface DayOneRawEntry {
  uuid?: string
  text?: string
  richText?: string
  creationDate?: string
  timeZone?: string
  isAllDay?: boolean
  location?: { latitude?: number; longitude?: number }
  weather?: {
    weatherCode?: string
    weatherServiceName?: string
    temperatureCelsius?: number
    relativeHumidity?: number
    windSpeedKPH?: number
  }
  photos?: DayOneAsset[]
  videos?: DayOneAsset[]
  audios?: DayOneAsset[]
  pdfAttachments?: DayOneAsset[]
}

export interface DayOneAsset {
  md5?: string
  type?: string
  filename?: string
  pdfName?: string
  orderInEntry?: number
}

export interface DayOneMedia {
  md5: string
  role: 'photo' | 'attachment'
  fileName: string
  mime: string
  order: number
}

export interface DayOneDraft {
  uuid: string
  createdAt: string
  date: string
  time?: string
  comment: string
  weather?: WeatherSnapshot
  media: DayOneMedia[]
}

export interface DayOneDraftOptions {
  photos: boolean
  videos: boolean
}

const CONDITIONS: Record<string, WeatherCondition> = {
  clear: 'clear',
  'clear-night': 'clear',
  fair: 'clear',
  'fair-night': 'clear',
  sunny: 'clear',
  'mostly-clear': 'clear',
  cloudy: 'cloudy',
  'mostly-cloudy': 'cloudy',
  'partly-cloudy': 'cloudy',
  'cloudy-night': 'cloudy',
  fog: 'cloudy',
  'fog-night': 'cloudy',
  wind: 'cloudy',
  rain: 'rain',
  showers: 'rain',
  drizzle: 'rain',
  'rain-night': 'rain',
  snow: 'snow',
  'snow-showers': 'snow',
  'snow-night': 'snow',
  flurries: 'snow',
  sleet: 'snow',
  thunderstorm: 'thunderstorm',
  'thunderstorm-night': 'thunderstorm',
  hail: 'thunderstorm',
}

export function dayOneFingerprint(uuid: string): string {
  return `dayone:${uuid}`
}

/** Дата и время записи в её часовом поясе, а не в поясе телефона. */
export function zonedDateTime(iso: string, timeZone: string | undefined): { date: string; time: string } {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) throw new Error(`Некорректная дата «${iso}»`)
  let zone = timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(instant)
  } catch {
    zone = 'UTC'
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  )
  const hour = parts.hour === '24' ? '00' : parts.hour
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` }
}

/** Текст Day One: из rich text, если он есть, иначе из поля text без служебных обратных слэшей Markdown. */
export function dayOneComment(entry: { text?: string; richText?: string }): string {
  if (entry.richText) {
    try {
      const document = JSON.parse(entry.richText) as { contents?: { text?: string; embeddedObjects?: unknown[] }[] }
      const lines = (document.contents ?? [])
        .filter((block) => !block.embeddedObjects?.length && block.text?.trim())
        .map((block) => block.text!.trim())
      const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (text) return text
    } catch {
      // Остаётся обычное поле text.
    }
  }
  return (entry.text ?? '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function mimeOf(type: string | undefined, role: 'photo' | 'attachment'): string {
  switch ((type ?? '').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'webp':
      return 'image/webp'
    case 'mov':
      return 'video/quicktime'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'm4a':
      return 'audio/mp4'
    case 'pdf':
      return 'application/pdf'
    default:
      return role === 'photo' ? 'image/jpeg' : 'application/octet-stream'
  }
}

function asset(item: DayOneAsset, role: 'photo' | 'attachment', fallback: string): DayOneMedia | undefined {
  const md5 = item.md5?.toLowerCase()
  if (!md5) return undefined
  const extension = (item.type || fallback).toLowerCase()
  const fileName = item.pdfName || item.filename || `${md5}.${extension}`
  return { md5, role, fileName, mime: mimeOf(item.type, role), order: item.orderInEntry ?? 0 }
}

function mediaOf(entry: DayOneRawEntry, options: DayOneDraftOptions): DayOneMedia[] {
  const items: DayOneMedia[] = []
  if (options.photos) for (const photo of entry.photos ?? []) {
    const item = asset(photo, 'photo', 'jpeg')
    if (item) items.push(item)
  }
  if (options.videos) for (const video of entry.videos ?? []) {
    const item = asset(video, 'attachment', 'mov')
    if (item) items.push(item)
  }
  for (const audio of entry.audios ?? []) {
    const item = asset(audio, 'attachment', 'm4a')
    if (item) items.push(item)
  }
  for (const pdf of entry.pdfAttachments ?? []) {
    const item = asset(pdf, 'attachment', 'pdf')
    if (item) items.push(item)
  }
  return items.sort((a, b) => a.order - b.order || a.md5.localeCompare(b.md5))
}

function weatherOf(entry: DayOneRawEntry, date: string): WeatherSnapshot | undefined {
  const weather = entry.weather
  if (!weather) return undefined
  const condition = weather.weatherCode ? CONDITIONS[weather.weatherCode] : undefined
  const temperature = typeof weather.temperatureCelsius === 'number' ? Math.round(weather.temperatureCelsius * 10) / 10 : undefined
  if (!condition && temperature === undefined) return undefined
  const snapshot: WeatherSnapshot = {
    source: weather.weatherServiceName || 'Day One',
    kind: 'manual',
    latitude: entry.location?.latitude ?? 0,
    longitude: entry.location?.longitude ?? 0,
    fetchedAt: entry.creationDate || new Date(0).toISOString(),
    period: 'day',
    forDate: date,
    condition,
    airTemperature: temperature,
  }
  if (typeof weather.relativeHumidity === 'number' && weather.relativeHumidity > 0) snapshot.humidityPercent = Math.round(weather.relativeHumidity)
  if (typeof weather.windSpeedKPH === 'number' && weather.windSpeedKPH > 0) snapshot.windMs = Math.round((weather.windSpeedKPH / 3.6) * 10) / 10
  return snapshot
}

/** Одна запись журнала → черновик дневника. Пустой день (нет текста и выбранных файлов) не переносится. */
export function dayOneDraft(entry: DayOneRawEntry, options: DayOneDraftOptions): DayOneDraft | undefined {
  if (!entry.uuid || !entry.creationDate) return undefined
  let when: { date: string; time: string }
  try {
    when = zonedDateTime(entry.creationDate, entry.timeZone)
  } catch {
    return undefined
  }
  const comment = dayOneComment(entry)
  const media = mediaOf(entry, options)
  if (!comment && media.length === 0) return undefined
  return {
    uuid: entry.uuid,
    createdAt: entry.creationDate,
    date: when.date,
    time: entry.isAllDay ? undefined : when.time,
    comment,
    weather: weatherOf(entry, when.date),
    media,
  }
}

export function dayOneDrafts(entries: DayOneRawEntry[], options: DayOneDraftOptions): { drafts: DayOneDraft[]; skippedEmpty: number } {
  const drafts: DayOneDraft[] = []
  let skippedEmpty = 0
  for (const entry of entries) {
    const draft = dayOneDraft(entry, options)
    if (draft) drafts.push(draft)
    else if (entry.uuid) skippedEmpty++
  }
  drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uuid.localeCompare(b.uuid))
  return { drafts, skippedEmpty }
}
