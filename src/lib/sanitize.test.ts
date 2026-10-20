// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { htmlToText, sanitizeHtml, textToHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('сохраняет заголовки, списки, таблицы и ссылки', () => {
    const html = sanitizeHtml(
      '<h2>Компост</h2><ul><li>ботва</li></ul><table><tr><td colspan="2">Месяц</td></tr></table><a href="https://ogorod.ru/x">статья</a>',
    )
    expect(html).toContain('<h2>Компост</h2>')
    expect(html).toContain('<li>ботва</li>')
    expect(html).toContain('<td colspan="2">Месяц</td>')
    expect(html).toContain('href="https://ogorod.ru/x"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('удаляет сценарии, стили, обработчики и опасные ссылки', () => {
    const html = sanitizeHtml(
      '<p onclick="alert(1)" style="color:red">текст</p><script>alert(1)</script><style>p{}</style><a href="javascript:alert(1)">ссылка</a><iframe src="https://x"></iframe>',
    )
    expect(html).toBe('<p>текст</p><a>ссылка</a>')
  })

  it('оставляет только изображения из вложений, внешние картинки убирает', () => {
    expect(sanitizeHtml('<img src="https://tracker.example/pixel.gif"><img data-file-id="abc" src="x" alt="фото">')).toBe(
      '<img data-file-id="abc" alt="фото">',
    )
  })

  it('разворачивает неизвестные теги, сохраняя текст', () => {
    expect(sanitizeHtml('<en-note><font>Газон</font> <center>стрижка</center></en-note>')).toBe('Газон стрижка')
  })
})

describe('htmlToText и textToHtml', () => {
  it('htmlToText даёт текст с переносами строк', () => {
    expect(htmlToText('<p>Первый</p><p>Второй<br>строка</p><ul><li>пункт</li></ul>')).toBe('Первый\nВторой\nстрока\nпункт')
  })

  it('textToHtml экранирует и разбивает на абзацы', () => {
    expect(textToHtml('Рецепт <фуфанон>\nна 10 л\n\nВторой абзац')).toBe('<p>Рецепт &lt;фуфанон&gt;<br>на 10 л</p><p>Второй абзац</p>')
  })
})
