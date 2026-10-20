/** «0.1.0+20261020-2305» → «Версия 0.1.0 от 20.10.2026, 23:05». */
export function versionLabel(version = __APP_VERSION__): string {
  const match = version.match(/^([\d.]+)\+(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/)
  if (!match) return `Версия ${version}`
  const [, number, year, month, day, hour, minute] = match
  return `Версия ${number} от ${day}.${month}.${year}, ${hour}:${minute}`
}
