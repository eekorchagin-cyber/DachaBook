import { useRef, type RefObject } from 'react'
import { wrapSelection, type FormatTag } from '../lib/richText'

const BUTTONS: { tag: FormatTag; label: string; title: string }[] = [
  { tag: 'b', label: 'Ж', title: 'Жирный' },
  { tag: 'i', label: 'К', title: 'Курсив' },
  { tag: 'u', label: 'Ч', title: 'Подчёркнутый' },
  { tag: 's', label: 'З', title: 'Зачёркнутый' },
]

/** Панель над textarea: оформляет выделенный фрагмент тегами b/i/u/s. */
export function FormatToolbar(props: {
  value: string
  onChange: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const last = useRef({ start: 0, end: 0 })

  const apply = (tag: FormatTag) => {
    const field = props.textareaRef.current
    const start = field?.selectionStart ?? last.current.start
    const end = field?.selectionEnd ?? last.current.end
    const next = wrapSelection(props.value, start, end, tag)
    props.onChange(next.value)
    requestAnimationFrame(() => {
      const el = props.textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.start, next.end)
      last.current = { start: next.start, end: next.end }
    })
  }

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Оформление текста">
      {BUTTONS.map((button) => (
        <button
          key={button.tag}
          type="button"
          className={`format-btn format-${button.tag}`}
          title={button.title}
          aria-label={button.title}
          onMouseDown={(event) => {
            // Не снимать выделение с textarea до клика.
            event.preventDefault()
            const field = props.textareaRef.current
            if (field) last.current = { start: field.selectionStart, end: field.selectionEnd }
          }}
          onClick={() => apply(button.tag)}
        >
          {button.label}
        </button>
      ))}
    </div>
  )
}
