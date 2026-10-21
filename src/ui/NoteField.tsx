import { useLayoutEffect, useRef } from 'react'

/** Многострочное пояснение: растёт по тексту, можно растянуть вручную. */
export function NoteField(props: { value: string; placeholder: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight + 2}px`
  }, [props.value])

  return (
    <textarea
      ref={ref}
      className="file-note"
      rows={2}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}
