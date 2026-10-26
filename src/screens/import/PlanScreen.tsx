import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { repo } from '../../app/store'
import { normalizeText } from '../../domain/diaryFilter'
import { periodText } from '../../domain/labels'
import { EmptyState, Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'
import { db } from '../../storage/db'
import { transferDraft } from '../../plan/actions'

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function PlanScreen() {
  const items = useLiveQuery(() => db.planDrafts.filter((item) => !item.deletedAt).toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const [type, setType] = useState<'all' | 'work' | 'observation'>('all')
  const [query, setQuery] = useState('')

  const byMonth = useMemo(() => {
    const words = normalizeText(query).split(/\s+/).filter(Boolean)
    const groups = new Map<number, NonNullable<typeof items>>()
    for (const item of items ?? []) {
      if (type !== 'all' && item.itemType !== type) continue
      if (!words.every((word) => normalizeText(item.text).includes(word))) continue
      for (const month of new Set(item.periods.map((period) => period.month))) {
        groups.set(month, [...(groups.get(month) ?? []), item])
      }
    }
    const weekIn = (item: NonNullable<typeof items>[number], month: number) =>
      Math.min(...item.periods.filter((period) => period.month === month).map((period) => period.week ?? 9))
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([month, list]) => [month, [...list].sort((a, b) => weekIn(a, month) - weekIn(b, month))] as const)
  }, [items, type, query])

  const objectName = (id: string) => objects?.find((item) => item.id === id)?.name

  return (
    <Screen title="Черновик плана" help="plan" back="/more" tab="/more">
      <div className="segmented">
        {(
          [
            ['all', 'Всё'],
            ['work', '⚒ Работы'],
            ['observation', '👁 Наблюдения'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={type === value ? 'active' : ''} onClick={() => setType(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="search-row">
        <input type="search" placeholder="Поиск по тексту" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск" />
      </div>
      {items && items.length === 0 && <EmptyState>Черновик пуст. Он заполняется импортом дневников из Evernote (раздел «Ещё» → «Импорт из Evernote»).</EmptyState>}
      <p className="hint">
        Работа, которая повторяется в нескольких месяцах, показана в каждом из них. «В план работ» превращает позицию-работу в плановую работу с теми же
        сроками и повтором каждый год; наблюдения остаются ориентиром. Перенесённая позиция отмечается и второй раз не переносится.
      </p>
      {byMonth.map(([month, list]) => (
        <section key={month} className="card">
          <h2>{MONTH_NAMES[month - 1]}</h2>
          <ul className="list">
            {list.map((item) => (
              <li key={item.id} className="plan-item">
                <div>
                  <span title={item.itemType === 'work' ? 'Предложение работы' : 'Типичное наблюдение'}>{item.itemType === 'work' ? '⚒' : '👁'}</span>{' '}
                  <span className="muted small">{periodText(item.periods)}</span>
                  {item.objectIds.map((id) => objectName(id)).filter(Boolean).length > 0 && (
                    <span className="muted small"> · {item.objectIds.map((id) => objectName(id)).filter(Boolean).join(', ')}</span>
                  )}
                </div>
                <p className="import-text">{item.text}</p>
                {item.seasonsDone.length > 0 && <p className="muted small">Выполнялось в сезонах: {item.seasonsDone.join(', ')}</p>}
                <div className="actions">
                  {item.itemType === 'work' &&
                    (item.transferred ? (
                      <a className="small source-link" href="#/works">
                        ✓ В плане работ
                      </a>
                    ) : (
                      <ActionButton onRun={async () => void (await transferDraft(item))}>В план работ</ActionButton>
                    ))}
                  <ActionButton
                    secondary
                    onRun={async () => {
                      if (confirm('Убрать позицию из черновика плана? Исходная строка останется в архиве импорта.')) await repo.remove('planDrafts', item.id, item.revision)
                    }}
                  >
                    Убрать
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  )
}
