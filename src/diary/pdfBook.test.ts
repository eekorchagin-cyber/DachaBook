import { describe, expect, it } from 'vitest'
import { pdfFromJpegs } from './pdfBook'

/** Минимальный JPEG 1×1, чтобы проверить сборку файла без холста. */
const PIXEL = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z'), (char) => char.charCodeAt(0))

describe('PDF дневника', () => {
  it('собирает файл с заголовком PDF и двумя страницами', async () => {
    const blob = pdfFromJpegs([
      { bytes: PIXEL, width: 1, height: 1 },
      { bytes: PIXEL, width: 1, height: 1 },
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('%%EOF')
    expect(blob.type).toBe('application/pdf')
  })
})
