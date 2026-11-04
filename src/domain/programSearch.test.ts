import { describe, expect, it } from 'vitest'
import { searchProgram, type ProgramSearchSource } from './programSearch'

const empty: ProgramSearchSource = { articles: [], works: [], events: [], consumables: [], objects: [], groups: [], zones: [], signs: [] }

describe('поиск по всей программе', () => {
  it('находит статью по слову в тексте, а не только в заголовке', () => {
    const sections = searchProgram('астильб', {
      ...empty,
      articles: [
        { title: 'Потребность в удобрениях', text: 'Астильбе весной нужна подкормка после схода снега.', href: '#/library/a' },
        { title: 'Газон', text: 'Стрижка раз в неделю.', href: '#/library/b' },
      ],
      works: [{ title: 'Укрытие астильбы', text: 'Осенью', href: '#/works?work=w' }],
    })
    expect(sections.map((section) => section.title)).toEqual(['Статьи', 'План работ'])
    expect(sections[0].hits[0]).toMatchObject({ title: 'Потребность в удобрениях', href: '#/library/a' })
    expect(sections[0].hits[0].excerpt).toContain('Астильбе')
    expect(sections[1].hits[0].title).toBe('Укрытие астильбы')
  })

  it('пустой запрос ничего не показывает', () => {
    expect(searchProgram('  ', { ...empty, articles: [{ title: 'Астильба', text: '', href: '#/library/a' }] })).toEqual([])
  })

  it('все слова запроса должны встретиться, буква ё не важна', () => {
    const source = { ...empty, consumables: [{ title: 'Удобрение для хвойных', text: 'Весна', href: '#/consumables?id=c' }] }
    expect(searchProgram('хвойн весна', source)).toHaveLength(1)
    expect(searchProgram('хвойн осень', source)).toEqual([])
    expect(searchProgram('ёлка', { ...empty, objects: [{ title: 'Елка у дома', text: '', href: '#/objects' }] })).toHaveLength(1)
  })
})
