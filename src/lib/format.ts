export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`
}

/** Safari на iPhone иногда обрывает IndexedDB, пока идёт долгий запрос в облако. */
export function isIdbTransient(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /in-progress transaction|Indexed Database server lost|database connection is closing|InvalidStateError.*database/i.test(text)
}

export function errorText(error: unknown): string {
  if (isIdbTransient(error)) {
    return 'База на этом устройстве временно не ответила. Закройте DachaBook полностью и откройте снова, затем повторите синхронизацию. Если запросы к облаку не проходят без VPN — включите VPN.'
  }
  if (error instanceof Error) return error.message || error.name
  return String(error)
}
