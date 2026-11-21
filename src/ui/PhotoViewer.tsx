import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useFileUrl } from '../files/files'
import { formatBytes } from '../lib/format'
import { db } from '../storage/db'
import { requestOriginal } from '../sync/runner'

/** Просмотр фото внутри приложения: сначала уменьшенная копия, оригинал — по кнопке из облака. */
export function PhotoViewer(props: { ids: string[]; index: number; notes?: Record<string, string>; onIndex: (index: number) => void; onClose: () => void }) {
  const id = props.ids[props.index]
  const url = useFileUrl(id, 'original')
  const thumb = useFileUrl(id, 'thumb')
  const file = useLiveQuery(() => db.files.get(id), [id])
  const count = props.ids.length
  const [broken, setBroken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { onIndex, onClose, index } = props

  useEffect(() => {
    setBroken(null)
    setError(null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < count - 1) onIndex(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [index, count, onIndex, onClose])

  const download = async () => {
    setError(null)
    setLoading(true)
    try {
      await requestOriginal(id)
      if (!(await db.fileContents.get(id))?.original) setError('Не удалось скачать оригинал. Проверьте сеть и Яндекс Диск.')
    } catch {
      setError('Не удалось скачать оригинал. Проверьте сеть и Яндекс Диск.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото" onClick={onClose}>
      <div className="viewer-bar" onClick={(event) => event.stopPropagation()}>
        <span>
          {index + 1} из {count}
        </span>
        <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
      </div>
      {broken === id ? (
        <p className="viewer-caption">Этот браузер не показывает формат HEIC. Фото сохранено без изменений и откроется в Safari и на iPhone.</p>
      ) : (
        (url ?? thumb) && (
          <img className="viewer-image" src={url ?? thumb} alt={props.notes?.[id] ?? 'Фото'} onError={() => setBroken(id)} onClick={(event) => event.stopPropagation()} />
        )
      )}
      {props.notes?.[id] && <p className="viewer-caption">{props.notes[id]}</p>}
      {!url && !broken && (
        <div className="viewer-nav" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="button secondary" disabled={loading} onClick={() => void download()}>
            {loading ? 'Скачивание…' : file?.size ? `Скачать оригинал (${formatBytes(file.size)})` : 'Скачать оригинал'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}
      {count > 1 && (
        <div className="viewer-nav" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="button secondary" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            ← Назад
          </button>
          <button type="button" className="button secondary" disabled={index === count - 1} onClick={() => onIndex(index + 1)}>
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}
