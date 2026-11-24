export type FormatTag = 'b' | 'i' | 'u' | 's'

const TAGS: FormatTag[] = ['b', 'i', 'u', 's']

/** Экранирование, кроме разрешённых inline-тегов оформления. */
export function escapeKeepingInline(text: string): string {
  const tokens: string[] = []
  const protectedText = text.replace(/<\/?(?:b|strong|i|em|u|s)>/gi, (tag) => {
    const normalized = tag.toLowerCase().replace('strong', 'b').replace('em', 'i')
    tokens.push(normalized)
    return `\u0000${tokens.length - 1}\u0000`
  })
  return protectedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? '')
}

/** Текст с inline-тегами → HTML абзацев для сохранения статьи или показа комментария. */
export function richTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeKeepingInline(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** HTML → текст для textarea с сохранением b/i/u/s. */
export function htmlToRichText(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    const inner = Array.from(el.childNodes).map(walk).join('')
    if (tag === 'br') return '\n'
    if (tag === 'b' || tag === 'strong') return `<b>${inner}</b>`
    if (tag === 'i' || tag === 'em') return `<i>${inner}</i>`
    if (tag === 'u') return `<u>${inner}</u>`
    if (tag === 's' || tag === 'strike' || tag === 'del') return `<s>${inner}</s>`
    if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'].includes(tag)) return `${inner}\n\n`
    return inner
  }
  return Array.from(parsed.body.childNodes)
    .map(walk)
    .join('')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Обернуть выделение тегом; повтор по тому же выделению снимает оформление. */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  tag: FormatTag,
): { value: string; start: number; end: number } {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const selected = value.slice(from, to)

  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return { value: value.slice(0, from) + inner + value.slice(to), start: from, end: from + inner.length }
  }

  const before = value.slice(0, from)
  const after = value.slice(to)
  if (before.endsWith(open) && after.startsWith(close)) {
    return {
      value: before.slice(0, before.length - open.length) + selected + after.slice(close.length),
      start: from - open.length,
      end: from - open.length + selected.length,
    }
  }

  const body = selected || 'текст'
  const next = before + open + body + close + after
  return { value: next, start: from + open.length, end: from + open.length + body.length }
}

export function isFormatTag(value: string): value is FormatTag {
  return (TAGS as string[]).includes(value)
}
