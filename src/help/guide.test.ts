import { describe, expect, it } from 'vitest'
import { GUIDE_SECTIONS, guideHtml } from './guide'
import guideSource from './guide.md?raw'

const ids = new Set([...guideHtml.matchAll(/<h\d id="([^"]+)"/g)].map((match) => match[1]))

describe('руководство пользователя', () => {
  it('каждая ссылка оглавления ведёт к существующему разделу', () => {
    const anchors = [...guideHtml.matchAll(/href="#([^"/][^"]*)"/g)].map((match) => decodeURIComponent(match[1]))
    expect(anchors.length).toBeGreaterThanOrEqual(20)
    expect(anchors.filter((anchor) => !ids.has(anchor))).toEqual([])
  })

  it('кнопки «Подробнее в руководстве» ведут к существующим разделам', () => {
    expect(Object.values(GUIDE_SECTIONS).filter((section) => !ids.has(section))).toEqual([])
  })

  it('не содержит места участка (публичный репозиторий)', () => {
    expect(guideSource).not.toMatch(/Минино|Емельянов/)
  })
})
