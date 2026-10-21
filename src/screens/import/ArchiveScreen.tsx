import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { repo } from '../../app/store'
import { todayAtSite } from '../../domain/dates'
import { normalizeText } from '../../domain/diaryFilter'
import type { ImportArchiveItem } from '../../domain/types'
import { parseRawDate } from '../../import/enex/diaryTable'
import { suggestObject } from '../../import/suggest'
import { htmlToText } from '../../lib/sanitize'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'

const PAGE = 80
const CHECKBOX = { checked: '☑', unchecked: '☐', none: '' }

/** Запись в дневнике из неиспользованной строки архива; связь с архивом сохраняется, повтор не дублирует. */
async function createEventFrom(item: ImportArchiveItem): Promise<void> {
  const season = Number(item.noteTitle.match(/(20\d{2})/)?.[1]) || new Date().getFullYear()
  const parsed = parseRawDate(item.rawDate ?? '', season)
  const objects = await db.objects.toArray()
  const objectId = objects.find((object) => object.name === suggestObject(item.text))?.id ?? objects[0]?.id
  const event = await repo.create('events', {
    type: item.checkbox && item.checkbox !== 'none' ? 'work' : 'observation',
    date: parsed.date ?? parsed.suggestion ?? todayAtSite().date,
    objectIds: objectId ? [objectId] : [],
    plantGroupIds: [],
    comment: item.text,
    photoIds: [],
    attachmentIds: [],
    source: { app: 'evernote', archiveItemIds: [item.id], files: [item.sourceFileName], fingerprint: `archive|${item.id}` },
  })
  await repo.update('importArchive', item.id, { createdRecordIds: [...item.createdRecordIds, event.id] }, item.revision)
  navigate(`/diary/${event.id}`)
}

export function ArchiveScreen() {
  const items = useLiveQuery(() => db.importArchive.filter((item) => !item.deletedAt).toArray(), [])
  const [unusedOnly, setUnusedOnly] = useState(true)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const list = useMemo(() => {
    const words = normalizeText(query).split(/\s+/).filter(Boolean)
    return (items ?? [])
      .filter((item) => !unusedOnly || item.createdRecordIds.length === 0)
      .filter((item) => words.every((word) => normalizeText(`${item.noteTitle} ${item.text}`).includes(word)))
      .sort((a, b) => a.noteTitle.localeCompare(b.noteTitle, 'ru') || (a.month ?? 0) - (b.month ?? 0))
  }, [items, unusedOnly, query])

  const unused = (items ?? []).filter((item) => item.createdRecordIds.length === 0).length

  return (
    <Screen title="Архив импорта" help="archive" back="/more" tab="/more">
      <p className="hint">
        Все строки и заметки из импортированных файлов в исходном виде. Всего: {items?.length ?? 0}, не использовано: {unused}.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} />
        Только неиспользованные
      </label>
      <div className="search-row">
        <input type="search" placeholder="Поиск" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск" />
      </div>
      {items && list.length === 0 && <EmptyState>{items.length === 0 ? 'Архив пуст: импорт ещё не выполнялся.' : 'Ничего не найдено.'}</EmptyState>}
      <ul className="list">
        {list.slice(0, limit).map((item) => (
          <li key={item.id} className="plan-item">
            <div className="muted small">
              {item.noteTitle}
              {item.month ? ` · месяц ${item.month}` : ''}
              {item.week ? `, нед. ${item.week}` : ''}
              {item.rawDate ? ` · дата «${item.rawDate}»` : ''} {item.checkbox ? CHECKBOX[item.checkbox] : ''}
            </div>
            <p className="import-text">{item.kind === 'note' ? htmlToText(item.text).slice(0, 300) : item.text}</p>
            {item.createdRecordIds.length > 0 ? (
              <span className="tag">использовано: {item.createdRecordIds.length}</span>
            ) : (
              item.kind === 'row' && (
                <ActionButton secondary onRun={() => createEventFrom(item)}>
                  Создать запись в дневнике
                </ActionButton>
              )
            )}
          </li>
        ))}
      </ul>
      {list.length > limit && (
        <button type="button" className="button secondary" onClick={() => setLimit((value) => value + PAGE)}>
          Показать ещё ({list.length - limit})
        </button>
      )}
    </Screen>
  )
}
