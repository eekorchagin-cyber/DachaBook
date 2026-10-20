import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { openFile } from '../files/files'
import { errorText, formatBytes } from '../lib/format'
import { db } from '../storage/db'

export function AttachmentRow({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const file = useLiveQuery(() => db.files.get(id), [id])
  const [error, setError] = useState<string | null>(null)
  return (
    <li className="attachment">
      <button type="button" className="link" onClick={() => openFile(id).catch((caught) => setError(errorText(caught)))}>
        📎 {file?.fileName ?? 'Файл'} {file && <span className="muted">({formatBytes(file.size)})</span>}
      </button>
      {error && <span className="error">{error}</span>}
      {onRemove && (
        <button type="button" className="icon-button" aria-label="Убрать файл" onClick={onRemove}>
          ×
        </button>
      )}
    </li>
  )
}
