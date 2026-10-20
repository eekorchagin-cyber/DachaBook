import { useState } from 'react'
import { updateApp, useUpdateReady } from '../sw/register'

export function UpdateBanner() {
  const ready = useUpdateReady()
  const [busy, setBusy] = useState(false)
  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <span>Доступна новая версия DachaBook</span>
      <button
        type="button"
        className="button small"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void updateApp().finally(() => setBusy(false))
        }}
      >
        {busy ? 'Обновляется…' : 'Обновить'}
      </button>
    </div>
  )
}
