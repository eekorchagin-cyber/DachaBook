import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function SearchDialog({ label, placeholder, initial, onFind, onClose }: { label: string; placeholder: string; initial: string; onFind: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onFind(value)
        }}
      >
        <h2>Поиск</h2>
        <label className="field">
          Что найти
          <input ref={field} type="search" placeholder={placeholder} aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" className="button">
            Найти
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

/** Лупа открывает окно поиска. Поле, которое само является поиском, этой кнопкой не дублируется. */
export function SearchButton({ query, label, placeholder, onFind }: { query: string; label: string; placeholder: string; onFind: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={query ? 'icon-button search-button active' : 'icon-button search-button'} aria-label="Поиск" aria-pressed={query !== ''} onClick={() => setOpen(true)}>
        {ICON}
      </button>
      {open && (
        <SearchDialog
          label={label}
          placeholder={placeholder}
          initial={query}
          onClose={() => setOpen(false)}
          onFind={(value) => {
            onFind(value.trim())
            setOpen(false)
            window.scrollTo({ top: 0 })
          }}
        />
      )}
    </>
  )
}

export function SearchQuery({ query, onClear }: { query: string; onClear: () => void }) {
  if (!query) return null
  return (
    <p className="search-query">
      Нашли по запросу «{query}».{' '}
      <button type="button" className="button-link source-link" onClick={onClear}>
        Сбросить
      </button>
    </p>
  )
}
