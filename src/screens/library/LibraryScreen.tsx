import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { normalizeText } from '../../domain/diaryFilter'
import type { ReferenceMaterial } from '../../domain/types'
import { htmlToText } from '../../lib/sanitize'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'

interface Indexed {
  material: ReferenceMaterial
  text: string
  haystack: string
}

export function LibraryScreen() {
  const materials = useLiveQuery(() => db.references.filter((item) => !item.deletedAt).toArray(), [])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const indexed = useMemo<Indexed[]>(
    () =>
      (materials ?? []).map((material) => {
        const text = htmlToText(material.html)
        return { material, text, haystack: normalizeText(`${material.title} ${material.tags.join(' ')} ${text}`) }
      }),
    [materials],
  )
  const tags = useMemo(() => [...new Set((materials ?? []).flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, 'ru')), [materials])
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  const found = indexed
    .filter((item) => (!tag || item.material.tags.includes(tag)) && words.every((word) => item.haystack.includes(word)))
    .sort((a, b) => a.material.title.localeCompare(b.material.title, 'ru'))

  return (
    <Screen
      title="Статьи"
      help="library"
      tab="/library"
      actions={
        <a className="button small" href="#/library/new">
          + Статья
        </a>
      }
    >
      <div className="search-row">
        <input type="search" placeholder="Поиск по заголовку, тексту и меткам" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск" />
      </div>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((item) => (
            <button key={item} type="button" className={tag === item ? 'chip active' : 'chip'} onClick={() => setTag(tag === item ? null : item)}>
              {item}
            </button>
          ))}
        </div>
      )}
      {materials && found.length === 0 && (
        <EmptyState>
          {materials.length === 0 ? 'Статей пока нет. Добавьте свою или импортируйте заметки из Evernote (раздел «Ещё»).' : 'Ничего не найдено.'}
        </EmptyState>
      )}
      <ul className="list">
        {found.map(({ material, text }) => (
          <li key={material.id}>
            <a className="list-item" href={`#/library/${material.id}`}>
              <strong>{material.title}</strong>
              <span className="muted small">
                {[material.tags.join(', '), material.fileIds.length > 0 && `файлов: ${material.fileIds.length}`].filter(Boolean).join(' · ')}
              </span>
              <span className="muted excerpt">{text.slice(0, 160)}</span>
            </a>
          </li>
        ))}
      </ul>
    </Screen>
  )
}
