import { looksLikeWork, suggestObject, suggestWorkKind, textKey } from './suggest'

/**
 * Разбивка текста на предложения для разделения одной строки на несколько записей.
 * Граница — «.», «!», «?» или «;», за которыми пробел и заглавная буква, либо перенос строки.
 * Не граница: инициалы («Н.А. Гармашовой»), сокращения со строчной буквой после («ст.л. на»), даты и адреса без пробела.
 */
export function splitSentences(text: string): string[] {
  const parts: string[] = []
  for (const line of text.split(/\n+/)) {
    let start = 0
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (!'.!?;'.includes(char)) continue
      let j = i + 1
      while (j < line.length && '.!?'.includes(line[j])) j++
      if (j >= line.length || !/\s/.test(line[j])) continue
      let k = j
      while (k < line.length && /\s/.test(line[k])) k++
      const next = line[k]
      if (!next) continue
      const upper = next !== next.toLowerCase() || /\d/.test(next)
      const initial = char === '.' && /(^|[\s.])\p{Lu}$/u.test(line.slice(start, i))
      if ((char === ';' || upper) && !initial) {
        parts.push(line.slice(start, j).trim())
        start = k
        i = k - 1
      }
    }
    const rest = line.slice(start).trim()
    if (rest) parts.push(rest)
  }
  return parts.filter((part) => textKey(part).length > 0)
}

export interface PartSuggestion {
  text: string
  type: 'work' | 'observation'
  objectName: string
  workKind?: string
}

export function suggestParts(text: string, isWork?: boolean): PartSuggestion[] {
  const sentences = splitSentences(text)
  return sentences.map((sentence) => {
    const work = sentences.length === 1 && isWork !== undefined ? isWork : looksLikeWork(sentence)
    return { text: sentence, type: work ? 'work' : 'observation', objectName: suggestObject(sentence), workKind: work ? suggestWorkKind(sentence) : undefined }
  })
}

/** Строку стоит разделить, если в ней несколько предложений разного типа или разных видов работ. */
export function canSplit(text: string): boolean {
  const parts = suggestParts(text)
  if (parts.length < 2) return false
  return new Set(parts.map((part) => part.type)).size > 1 || new Set(parts.map((part) => part.workKind ?? '')).size > 1
}
