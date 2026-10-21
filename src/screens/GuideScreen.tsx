import { useEffect, useRef } from 'react'
import { guideHtml } from '../help/guide'
import { Screen } from '../ui/Screen'

/** Руководство пользователя; ссылки оглавления прокручивают к разделу, не трогая адрес экрана. */
export function GuideScreen({ section }: { section?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!section) return
    // Прокрутка в следующем кадре: общий сброс прокрутки при смене экрана выполняется после эффектов экрана.
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector(`[id="${CSS.escape(section)}"]`)?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [section])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const click = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('#') && !href.startsWith('#/')) {
        event.preventDefault()
        root.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } else if (/^https?:/.test(href)) {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      }
    }
    root.addEventListener('click', click)
    return () => root.removeEventListener('click', click)
  }, [])

  return (
    <Screen title="Как пользоваться" back="/more" tab="/more">
      <article ref={ref} className="card guide" dangerouslySetInnerHTML={{ __html: guideHtml }} />
    </Screen>
  )
}
