const ALLOWED_TAGS = new Set([
  'p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'span', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
])

/** Удаляются вместе с содержимым. */
const DROPPED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'svg', 'math', 'link', 'meta', 'head', 'title'])

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  img: ['data-file-id', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  col: ['span'],
}

function safeHref(value: string): string | null {
  const trimmed = value.trim()
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : null
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (DROPPED_TAGS.has(tag)) return null

  const children = Array.from(element.childNodes)
    .map((child) => cleanNode(child, doc))
    .filter((child): child is Node => child !== null)

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment()
    children.forEach((child) => fragment.appendChild(child))
    return fragment
  }

  const clean = doc.createElement(tag)
  for (const name of ALLOWED_ATTRIBUTES[tag] ?? []) {
    const value = element.getAttribute(name)
    if (value === null) continue
    if (name === 'href') {
      const href = safeHref(value)
      if (href) {
        clean.setAttribute('href', href)
        clean.setAttribute('target', '_blank')
        clean.setAttribute('rel', 'noopener noreferrer')
      }
    } else {
      clean.setAttribute(name, value)
    }
  }
  if (tag === 'img' && !clean.hasAttribute('data-file-id')) return null
  children.forEach((child) => clean.appendChild(child))
  return clean
}

/**
 * Оставляет безопасный набор разметки: заголовки, абзацы, списки, таблицы, ссылки и изображения из вложений.
 * Сценарии, стили, обработчики событий и внешние картинки (отслеживание) удаляются.
 */
export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.implementation.createHTMLDocument('')
  const container = out.createElement('div')
  Array.from(parsed.body.childNodes).forEach((child) => {
    const clean = cleanNode(child, out)
    if (clean) container.appendChild(clean)
  })
  return container.innerHTML
}

/** Обычный текст из HTML для поиска и превью. */
export function htmlToText(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  parsed.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  parsed.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((block) => block.append('\n'))
  return (parsed.body.textContent ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

/** Текст, введённый вручную, в абзацы HTML. */
export function textToHtml(text: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
