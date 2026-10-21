import { sanitizeHtml } from '../../lib/sanitize'
import { parseEnml } from './diaryTable'

export interface MediaTarget {
  fileId: string
  isImage: boolean
  fileName: string
}

/**
 * ENML обычной заметки → безопасный HTML справочного материала.
 * Картинки встают на свои места (img data-file-id), прочие вложения заменяются пометкой «📎 имя файла».
 */
export function enmlToHtml(content: string, resolve: (hash: string) => MediaTarget | undefined): string {
  const doc = parseEnml(content)
  doc.querySelectorAll('en-media').forEach((media) => {
    const target = resolve(media.getAttribute('hash')?.toLowerCase() ?? '')
    if (!target) return media.remove()
    if (target.isImage) {
      const image = doc.createElement('img')
      image.setAttribute('data-file-id', target.fileId)
      image.setAttribute('alt', target.fileName)
      media.replaceWith(image)
    } else {
      media.replaceWith(doc.createTextNode(`📎 ${target.fileName}`))
    }
  })
  doc.querySelectorAll('en-todo').forEach((todo) => todo.replaceWith(doc.createTextNode(todo.getAttribute('checked') === 'true' ? '☑ ' : '☐ ')))
  doc.querySelectorAll('en-crypt').forEach((node) => node.replaceWith(doc.createTextNode('[зашифрованный фрагмент не импортирован]')))
  return sanitizeHtml(doc.body.innerHTML)
}
