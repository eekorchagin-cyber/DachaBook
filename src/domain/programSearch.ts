import { excerptAround, includesAllWords } from './diaryFilter'

export interface ProgramSearchItem {
  title: string
  text: string
  href: string
}

export interface ProgramSearchSource {
  articles: ProgramSearchItem[]
  works: ProgramSearchItem[]
  events: ProgramSearchItem[]
  consumables: ProgramSearchItem[]
  objects: ProgramSearchItem[]
  groups: ProgramSearchItem[]
  zones: ProgramSearchItem[]
  signs: ProgramSearchItem[]
}

export interface ProgramHit {
  title: string
  excerpt?: string
  href: string
}

export interface ProgramSection {
  title: string
  hits: ProgramHit[]
}

const PER_SECTION = 8

/** Поиск по дневнику, статьям, плану и остальным спискам. Пустой запрос ничего не возвращает. */
export function searchProgram(query: string, source: ProgramSearchSource): ProgramSection[] {
  if (!query.trim()) return []
  const sections: { title: string; items: ProgramSearchItem[] }[] = [
    { title: 'Статьи', items: source.articles },
    { title: 'План работ', items: source.works },
    { title: 'Дневник', items: source.events },
    { title: 'Расходные материалы', items: source.consumables },
    { title: 'Объекты', items: source.objects },
    { title: 'Группы растений', items: source.groups },
    { title: 'Полив', items: source.zones },
    { title: 'Народные приметы', items: source.signs },
  ]
  return sections.flatMap(({ title, items }) => {
    const hits = items
      .flatMap((item) => {
        const blob = `${item.title}\n${item.text}`
        if (!includesAllWords(query, blob)) return []
        return [{ title: item.title, excerpt: excerptAround(query, item.text) ?? excerptAround(query, blob), href: item.href }]
      })
      .slice(0, PER_SECTION)
    return hits.length > 0 ? [{ title, hits }] : []
  })
}
