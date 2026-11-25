import { useLayoutEffect, useRef } from 'react'

/** Многострочное поле: высота растёт по тексту, вручную тоже можно растянуть. */
export function GrowingTextarea(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
  'aria-label'?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.max(field.scrollHeight, field.clientHeight)}px`
  }, [props.value])

  return (
    <textarea
      ref={ref}
      className={props.className}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}
