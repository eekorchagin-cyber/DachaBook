import { useMemo } from 'react'
import { richTextToHtml } from '../lib/richText'
import { sanitizeHtml } from '../lib/sanitize'

/** Безопасный показ комментария или заметки с inline-оформлением. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitizeHtml(richTextToHtml(text)), [text])
  if (!text.trim()) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
