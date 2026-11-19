/** Сколько ещё займёт этап по средней скорости уже пройденных элементов. */
export class StageEta {
  private startedAt: number | undefined
  private done = 0

  constructor(private total = 0) {}

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

  /** Хвост к строке этапа: пусто, «оцениваю время» или «осталось около …». */
  suffix(now = Date.now()): string {
    if (this.total <= 0 || this.done >= this.total) return ''
    const ms = this.remainingMs(now)
    if (ms == null) return ' Оцениваю время.'
    return ` ${remainingPhrase(ms)}`
  }
}

/** «Осталось около 2 часов 5 минут.» Числительные — в родительном падеже после «около». */
export function remainingPhrase(ms: number): string {
  if (ms < 60_000) return 'Осталось меньше минуты.'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `Осталось около ${minutes} ${genitive(minutes, 'минуты', 'минут')}.`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const hourPart = `${hours} ${genitive(hours, 'часа', 'часов')}`
  return rest ? `Осталось около ${hourPart} ${rest} ${genitive(rest, 'минуты', 'минут')}.` : `Осталось около ${hourPart}.`
}

/** 1, 21 — форма единственного; остальные — множественного. */
function genitive(count: number, one: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  return mod10 === 1 && mod100 !== 11 ? one : many
}
