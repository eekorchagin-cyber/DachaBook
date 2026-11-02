import { useState } from 'react'
import { addPhoto, isImageFile } from '../files/files'
import { PhotoThumb } from '../screens/diary/EventCard'
import { NoteField } from './NoteField'
import { PhotoViewer } from './PhotoViewer'

/** Фото с пояснениями: те же файлы, что у записей дневника. */
export function PhotoFields(props: {
  ids: string[]
  notes: Record<string, string>
  onChange: (ids: string[], notes: Record<string, string>) => void
}) {
  const [viewer, setViewer] = useState<number | null>(null)
  const [error, setError] = useState('')

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    const ids = [...props.ids]
    try {
      for (const file of files) {
        if (!isImageFile(file)) continue
        const stored = await addPhoto(file, file.name || 'photo.jpg')
        if (!ids.includes(stored.id)) ids.push(stored.id)
      }
      props.onChange(ids, props.notes)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить фото')
    }
  }

  return (
    <div className="photo-block">
      <p className="hint">Фото хранятся в дневнике и уходят в облако вместе с остальными файлами.</p>
      {props.ids.length > 0 && (
        <div className="photo-grid">
          {props.ids.map((photoId, index) => (
            <div key={photoId} className="photo-cell">
              <span className="thumb-wrap">
                <PhotoThumb id={photoId} onClick={() => setViewer(index)} />
                <button
                  type="button"
                  className="thumb-remove"
                  aria-label="Убрать фото"
                  onClick={() => props.onChange(props.ids.filter((item) => item !== photoId), props.notes)}
                >
                  ×
                </button>
              </span>
              <NoteField
                placeholder="Пояснение"
                value={props.notes[photoId] ?? ''}
                onChange={(value) => props.onChange(props.ids, { ...props.notes, [photoId]: value })}
              />
            </div>
          ))}
        </div>
      )}
      {viewer !== null && props.ids.length > 0 && (
        <PhotoViewer ids={props.ids} index={Math.min(viewer, props.ids.length - 1)} notes={props.notes} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
      <div className="actions">
        <label className="button secondary">
          Фото из галереи
          <input type="file" accept="image/*" multiple hidden onChange={(event) => void add(event.target.files)} />
        </label>
        <label className="button secondary">
          Камера
          <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => void add(event.target.files)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
