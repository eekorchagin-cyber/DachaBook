import { describe, expect, it } from 'vitest'
import { labelProgramTarget, pageLink } from './labelProgram'

describe('программа печати меток', () => {
  it('принимает сайт и адрес вида name://', () => {
    expect(labelProgramTarget('')).toBeNull()
    expect(labelProgramTarget('   ')).toBeNull()
    expect(labelProgramTarget('https://niimbot.com/editor')).toBe('https://niimbot.com/editor')
    expect(labelProgramTarget('niimbot.com/editor')).toBe('https://niimbot.com/editor')
    expect(labelProgramTarget('niimbot://')).toBe('niimbot://')
    expect(labelProgramTarget('shortcuts://run-shortcut?name=Печать')).toBe('shortcuts://run-shortcut?name=%D0%9F%D0%B5%D1%87%D0%B0%D1%82%D1%8C')
  })

  it('отвергает опасные схемы и текст без адреса', () => {
    expect(labelProgramTarget('javascript:alert(1)')).toBeNull()
    expect(labelProgramTarget('data:text/html,hi')).toBeNull()
    expect(labelProgramTarget('file:///Applications/Pages.app')).toBeNull()
    expect(labelProgramTarget('Pages')).toBeNull()
  })

  it('собирает ссылку на карточку в текущем адресе приложения', () => {
    expect(pageLink('/objects?object=1', 'https://eekorchagin-cyber.github.io/DachaBook/index.html?x=1#/home')).toBe(
      'https://eekorchagin-cyber.github.io/DachaBook/index.html?x=1#/objects?object=1',
    )
  })
})
