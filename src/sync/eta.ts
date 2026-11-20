/**
 * Срок этапа «фото и файлы» по всему объёму, а не по каждому файлу.
 * До первой передачи берётся уже известная скорость. Дальше — скорость этого этапа и оставшиеся байты.
 */
export class StageClock {
  private totalBytes: number
  private priorBytesPerSecond: number
  private doneBytes = 0
  private transferStartedAt: number | undefined

  constructor(totalBytes: number, priorBytesPerSecond = 0) {
    this.totalBytes = totalBytes
    this.priorBytesPerSecond = priorBytesPerSecond
  }

  pending(): number {
    return Math.max(0, this.totalBytes - this.doneBytes)
  }

  /** Первая настоящая передача, а не просмотр уже скопированных файлов. */
  markStart(now = Date.now()): void {
    if (this.transferStartedAt == null) this.transferStartedAt = now
  }

  /** planned — сколько собирались передать, sent — сколько передали. Разница из этапа уходит. */
  settle(planned: number, sent: number): void {
    this.totalBytes -= Math.max(0, planned - sent)
    if (sent > 0) this.doneBytes += sent
  }

  /** Скорость этого этапа, байт в секунду. Пока передача короче секунды — ещё нет. */
  rate(now = Date.now()): number | undefined {
    if (this.doneBytes <= 0 || this.transferStartedAt == null) return undefined
    const seconds = (now - this.transferStartedAt) / 1000
    if (seconds < 1) return undefined
    return this.doneBytes / seconds
  }

  /** Когда закончится весь оставшийся объём. null — скорость ещё неизвестна, undefined — передавать нечего. */
  endsAt(now = Date.now()): number | null | undefined {
    const left = this.pending()
    if (left <= 0) return undefined
    const rate = this.rate(now) ?? (this.priorBytesPerSecond > 0 ? this.priorBytesPerSecond : undefined)
    if (rate == null) return null
    return now + (left / rate) * 1000
  }
}

/** Строка этапа и срок до её конца. Просроченный или ещё неизвестный срок — «оцениваю время». */
export function withStageTime(head: string, endsAt: number | null, now = Date.now()): string {
  if (endsAt == null || endsAt - now <= 0) return `${head} До конца этапа: оцениваю время.`
  return `${head} ${remainingPhrase(endsAt - now, new Date(now))}`
}

/** Сколько ещё займёт этап по средней скорости уже пройденных элементов. */
export class StageEta {
  private total: number
  private startedAt: number | undefined
  private done = 0

  constructor(total = 0) {
    this.total = total
  }

  start(now = Date.now()): void {
    this.startedAt = now
    this.done = 0
  }

  addTotal(count: number): void {
    this.total += count
  }

  finish(count = 1): void {
    this.done += count
  }

  remainingMs(now = Date.now()): number | undefined {
    const left = this.total - this.done
    if (left <= 0 || this.done < 1 || this.startedAt == null) return undefined
    const elapsed = now - this.startedAt
    if (elapsed < 1000) return undefined
    return (elapsed / this.done) * left
  }

  /** Сколько элементов этапа уже пройдено и сколько их всего. */
  progress(): string {
    return `${this.done} из ${this.total}`
  }

  /** Срок до конца всей очереди этапа, не текущего файла. */
  suffix(now = Date.now()): string {
    if (this.total <= 0 || this.done >= this.total) return ''
    const ms = this.remainingMs(now)
    if (ms == null) return ' До конца этапа: оцениваю время.'
    return ` ${remainingPhrase(ms, new Date(now))}`
  }
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** До часа — длительность («около 40 минут»). Дольше — момент окончания: «Ожидается, что этап завершится в 15:48», завтра или с датой. */
export function remainingPhrase(ms: number, now = new Date()): string {
  if (ms < 60_000) return 'До конца этапа осталось меньше минуты.'
  const minutes = Math.round(ms / 60_000)
  if (minutes <= 60) {
    if (minutes === 60) return 'До конца этапа осталось около 1 часа.'
    return `До конца этапа осталось около ${minutes} ${genitive(minutes, 'минуты', 'минут')}.`
  }
  const end = new Date(now.getTime() + ms)
  const time = `${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}`
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(end) - day(now)) / 86_400_000)
  if (days <= 0) return `Ожидается, что этап завершится в ${time}.`
  if (days === 1) return `Ожидается, что этап завершится завтра в ${time}.`
  const date = `${end.getDate()} ${MONTHS[end.getMonth()]}`
  const year = end.getFullYear() === now.getFullYear() ? '' : ` ${end.getFullYear()}`
  return `Ожидается, что этап завершится ${date}${year} в ${time}.`
}

/** 1, 21 — форма единственного; остальные — множественного. */
function genitive(count: number, one: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  return mod10 === 1 && mod100 !== 11 ? one : many
}
