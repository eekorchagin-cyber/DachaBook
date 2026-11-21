import { useState } from 'react'
import { useFileUrl } from '../files/files'

/** Широкое фото дачи: уменьшенная копия (оригинал на телефоне не хранится после выгрузки в облако). */
export function PlotPhoto({ id }: { id: string }) {
  const thumb = useFileUrl(id, 'thumb')
  const original = useFileUrl(id, 'original')
  const url = original ?? thumb
  const [broken, setBroken] = useState<string | null>(null)
  if (!url || broken === url) return <span className="plot-hero-fallback">Фото дачи</span>
  return <img className="plot-hero-image" src={url} alt="Фото дачи" onError={() => setBroken(url)} />
}
