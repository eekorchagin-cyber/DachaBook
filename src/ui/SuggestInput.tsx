import { useState } from 'react'
import { normalizeName } from '../domain/consumables'

interface SuggestInputProps {
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  /** Список вариантов выравнивается по правому краю поля (поле у правого края экрана). */
  alignEnd?: boolean
}

/**
 * Поле с подсказками из справочника. Стандартный список браузера (datalist) на iPhone показывается
 * только в строке над клавиатурой и часто не работает, поэтому подсказки — свой список под полем.
 */
export function SuggestInput({ value, options, onChange, placeholder, ariaLabel, alignEnd = false }: SuggestInputProps) {
  const [open, setOpen] = useState(false)
  const key = normalizeName(value)
  const matches = options.filter((option) => normalizeName(option) !== key && (!key || normalizeName(option).includes(key))).slice(0, 8)
  return (
    <span className="suggest">
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && matches.length > 0 && (
        <ul className={alignEnd ? 'suggest-list end' : 'suggest-list'} role="listbox" aria-label={ariaLabel ? `Варианты: ${ariaLabel}` : 'Варианты'}>
          {matches.map((option) => (
            <li key={option}>
              {/* mousedown без действия по умолчанию: поле не теряет фокус, и нажатие успевает выбрать вариант. */}
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
