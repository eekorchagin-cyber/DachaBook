import { Marked } from 'marked'
import guideSource from './guide.md?raw'

/** Якорь заголовка в стиле GitHub: так ссылки оглавления совпадают с заголовками. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
}

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`
    },
  },
})

/** Текст справки — собственный файл приложения, поэтому разметка не очищается: нужны якоря оглавления. */
export const guideHtml = marked.parse(guideSource) as string

/** Раздел руководства для каждого экрана с кнопкой «Помощь». */
export const GUIDE_SECTIONS: Record<string, string> = {
  home: '3-пять-минут-в-день-записи-прямо-на-участке',
  event: '3-пять-минут-в-день-записи-прямо-на-участке',
  diary: '4-дневник-найти-что-и-когда-делали',
  trash: '4-дневник-найти-что-и-когда-делали',
  objects: '5-объекты-и-растения-опишите-участок-один-раз',
  library: '6-справочник-инструкции-статьи-и-документы-под-рукой',
  import: '7-перенос-многолетней-истории-из-evernote',
  archive: '7-перенос-многолетней-истории-из-evernote',
  plan: '8-сезонный-план-ничего-не-забыть-вовремя',
  backup: '16-сохранность-данных-и-резервные-копии',
  settings: '17-настройки-под-себя',
  more: '1-зачем-dachabook-и-как-он-экономит-ваше-время',
}
