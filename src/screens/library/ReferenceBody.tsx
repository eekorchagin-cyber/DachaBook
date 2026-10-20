import { useEffect, useMemo, useRef } from 'react'
import { sanitizeHtml } from '../../lib/sanitize'
import { db } from '../../storage/db'

/** Показывает очищенную разметку; картинки берутся из вложений по data-file-id. */
export function ReferenceBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const clean = useMemo(() => sanitizeHtml(html), [html])

  useEffect(() => {
    const urls: string[] = []
    let cancelled = false
    const images = Array.from(ref.current?.querySelectorAll<HTMLImageElement>('img[data-file-id]') ?? [])
    void (async () => {
      for (const image of images) {
        const content = await db.fileContents.get(image.dataset.fileId ?? '')
        const blob = content?.original ?? content?.thumb
        if (cancelled || !blob) continue
        const url = URL.createObjectURL(blob)
        urls.push(url)
        image.src = url
      }
    })()
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [clean])

  return <div ref={ref} className="reference-body" dangerouslySetInnerHTML={{ __html: clean }} />
}
