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

/** До часа — длительность. Дольше — примерное время окончания: сегодня «около 14:35», после полуночи «завтра в 1:20», дальше — дата. */
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
  if (days <= 0) return `До конца этапа около ${time}.`
  if (days === 1) return `До конца этапа завтра в ${time}.`
  const date = `${end.getDate()} ${MONTHS[end.getMonth()]}`
  const year = end.getFullYear() === now.getFullYear() ? '' : ` ${end.getFullYear()}`
  return `До конца этапа ${date}${year} в ${time}.`
}

/** 1, 21 — форма единственного; остальные — множественного. */
function genitive(count: number, one: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  return mod10 === 1 && mod100 !== 11 ? one : many
}
