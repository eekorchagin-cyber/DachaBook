export interface PlotLocation {
  latitude: number
  longitude: number
}

/** Точность для прогноза погоды: 2 знака ≈ 1 км, точнее для погоды не нужно. */
export function roundLocation(location: PlotLocation): PlotLocation {
  return { latitude: Math.round(location.latitude * 100) / 100, longitude: Math.round(location.longitude * 100) / 100 }
}

/** Разбирает «55.75, 37.62», «55.75 37.62» и «55,75 37,62» (как копируют из Яндекс Карт и с телефона). */
export function parseLocation(text: string): PlotLocation | null {
  const trimmed = text.trim()
  const parts = /^-?\d+(?:\.\d+)?\s*[,;\s]\s*-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed.split(/\s*[,;\s]\s*/) : trimmed.split(/\s*[;\s]\s*/).map((part) => part.replace(',', '.'))
  if (parts.length !== 2) return null
  const [latitude, longitude] = parts.map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return roundLocation({ latitude, longitude })
}

export function locationText(location: PlotLocation): string {
  return `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`
}
