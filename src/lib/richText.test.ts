/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { escapeKeepingInline, htmlToRichText, richTextToHtml, wrapSelection } from './richText'

describe('оформление текста', () => {
  it('оборачивает и снимает выделение', () => {
    expect(wrapSelection('привет мир', 0, 6, 'b')).toEqual({ value: '<b>привет</b> мир', start: 3, end: 9 })
    expect(wrapSelection('<b>привет</b> мир', 0, 13, 'b')).toEqual({ value: 'привет мир', start: 0, end: 6 })
    expect(wrapSelection('<b>привет</b>', 3, 9, 'b')).toEqual({ value: 'привет', start: 0, end: 6 })
  })

  it('сохраняет inline-теги при сборке HTML', () => {
    expect(richTextToHtml('Скосил <b>газон</b>\nи грабли\n\nВторой')).toBe(
      '<p>Скосил <b>газон</b><br>и грабли</p><p>Второй</p>',
    )
    expect(escapeKeepingInline('a <b>x</b> & y <z>')).toBe('a <b>x</b> &amp; y &lt;z&gt;')
  })

  it('круг HTML → текст → HTML сохраняет оформление', () => {
    const html = '<p>Укрыл <b>розы</b> и <i>гортензии</i></p>'
    const text = htmlToRichText(html)
    expect(text).toContain('<b>розы</b>')
    expect(text).toContain('<i>гортензии</i>')
    expect(richTextToHtml(text)).toContain('<b>розы</b>')
  })
})
