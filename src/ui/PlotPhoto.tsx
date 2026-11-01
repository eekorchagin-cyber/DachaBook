import { useState } from 'react'
import { useFileUrl } from '../files/files'

/** Широкое фото дачи: оригинал, а если его ещё нет на устройстве — уменьшенная копия. */
export function PlotPhoto({ id }: { id: string }) {
  const url = useFileUrl(id, 'original')
  const [broken, setBroken] = useState<string | null>(null)
  if (!url || broken === url) return <span className="plot-hero-fallback">Фото дачи</span>
  return <img className="plot-hero-image" src={url} alt="Фото дачи" onError={() => setBroken(url)} />
}
