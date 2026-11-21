import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

function SearchDialog({
  label,
  placeholder,
  initial,
  onFind,
  onClose,
  tags,
  initialTag,
}: {
  label: string
  placeholder: string
  initial: string
  onFind: (value: string, tag: string | null) => void
  onClose: () => void
  tags?: string[]
  initialTag?: string | null
}) {
  const [value, setValue] = useState(initial)
  const [tag, setTag] = useState<string | null>(initialTag ?? null)
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
          onFind(value, tag)
        }}
      >
        <h2>Поиск</h2>
        <label className="field">
          Что найти
          <input ref={field} type="search" placeholder={placeholder} aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        {tags && tags.length > 0 && (
          <fieldset className="chips">
            <legend>Метка</legend>
            {tags.map((item) => (
              <button
                key={item}
                type="button"
                className={tag === item ? 'chip active' : 'chip'}
                onClick={() => setTag(tag === item ? null : item)}
              >
                {item}
              </button>
            ))}
          </fieldset>
        )}
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

const SEARCH_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

const FILTER_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <path d="M4 5h16l-6.5 7.5v5l-3 1.5v-6.5L4 5z" />
  </svg>
)

/** Воронка в шапке: слева от лупы, открывает или скрывает панель фильтров. */
export function FilterButton({ open, active, onToggle }: { open: boolean; active?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={open || active ? 'icon-button filter-button active' : 'icon-button filter-button'}
      aria-label="Фильтры"
      aria-pressed={open}
      onClick={onToggle}
    >
      {FILTER_ICON}
    </button>
  )
}

/** Лупа в шапке слева от «?». Опционально — метки внутри окна поиска (статьи). */
export function SearchButton({
  query,
  label,
  placeholder,
  onFind,
  tags,
  tag,
  onTag,
}: {
  query: string
  label: string
  placeholder: string
  onFind: (value: string) => void
  tags?: string[]
  tag?: string | null
  onTag?: (tag: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const active = query !== '' || !!tag
  return (
    <>
      <button type="button" className={active ? 'icon-button search-button active' : 'icon-button search-button'} aria-label="Поиск" aria-pressed={active} onClick={() => setOpen(true)}>
        {SEARCH_ICON}
      </button>
      {open && (
        <SearchDialog
          label={label}
          placeholder={placeholder}
          initial={query}
          tags={tags}
          initialTag={tag}
          onClose={() => setOpen(false)}
          onFind={(value, nextTag) => {
            onFind(value.trim())
            onTag?.(nextTag)
            setOpen(false)
            window.scrollTo({ top: 0 })
          }}
        />
      )}
    </>
  )
}

export function SearchQuery({
  query,
  tag,
  onClear,
}: {
  query: string
  tag?: string | null
  onClear: () => void
}) {
  if (!query && !tag) return null
  const parts: ReactNode[] = []
  if (query) parts.push(<>по запросу «{query}»</>)
  if (tag) parts.push(<>по метке «{tag}»</>)
  return (
    <p className="search-query">
      Нашли {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? ' и ' : ''}
          {part}
        </span>
      ))}
      .{' '}
      <button type="button" className="button-link source-link" onClick={onClear}>
        Сбросить
      </button>
    </p>
  )
}
