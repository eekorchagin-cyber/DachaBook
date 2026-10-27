import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { repo } from '../app/store'
import { formatDate } from '../domain/dates'
import type { DiaryEvent, FolkSign, ReferenceMaterial } from '../domain/types'
import { folkSignDate } from '../import/folkSigns'
import { db } from '../storage/db'
import { purgeDoc } from '../sync/engine'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const LINKS = [
  { href: '#/guide', title: 'Как пользоваться DachaBook', text: 'Руководство: чтобы дача была в порядке и доставляла минимум хлопот' },
  { href: '#/sync', title: 'Облако', text: 'Синхронизация через Яндекс Диск между iPhone, Mac и Windows' },
  { href: '#/dictionaries', title: 'Справочники', text: 'Виды работ, единицы, объекты, растения, расходные материалы, народные приметы' },
  { href: '#/works', title: 'План работ', text: 'Сезонные работы, сроки, заморозки и водопровод, отметки о выполнении' },
  { href: '#/diary/book', title: 'Дневник в PDF', text: 'Вся история книгой: главы по годам, параграфы по месяцам' },
  { href: '#/share', title: 'Фото в дневник', text: 'Выбрать снимки в Медиатеке и прикрепить к записи' },
  { href: '#/plan', title: 'Черновик плана из Evernote', text: 'Предложения работ и типичные наблюдения по месяцам — перенос в план работ' },
  { href: '#/import', title: 'Импорт из Evernote', text: 'Перенос дневников и заметок из файлов ENEX' },
  { href: '#/archive', title: 'Архив импорта', text: 'Исходные строки и заметки Evernote, в том числе неиспользованные' },
  { href: '#/trash', title: 'Корзина', text: 'Удалённые записи и материалы, восстановление' },
  { href: '#/backup', title: 'Резервная копия', text: 'Копия в файл, автокопия в папку, восстановление' },
  { href: '#/settings', title: 'Настройки', text: 'Имя, участок, внешний вид' },
]

export function MoreScreen() {
  return (
    <Screen title="Ещё" help="more" tab="/more">
      <ul className="list">
        {LINKS.map((link) => (
          <li key={link.href}>
            <a className="list-item" href={link.href}>
              <strong>{link.title}</strong>
              <span className="muted">{link.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </Screen>
  )
}

const TRASH_DAYS = 30

interface TrashItem {
  collection: 'events' | 'references' | 'folkSigns'
  doc: DiaryEvent | ReferenceMaterial | FolkSign
  title: string
  subtitle: string
}

/** Окончательное удаление записи и её фото и файлов, на которые больше ничто не ссылается. */
async function purge(item: TrashItem): Promise<void> {
  await purgeDoc(db, item.collection, item.doc.id)
  const fileIds = item.collection === 'events' ? [...(item.doc as DiaryEvent).photoIds, ...(item.doc as DiaryEvent).attachmentIds] : item.collection === 'references' ? (item.doc as ReferenceMaterial).fileIds : []
  if (fileIds.length === 0) return
  const events = await db.events.toArray()
  const references = await db.references.toArray()
  const plan = await db.planDrafts.toArray()
  for (const id of fileIds) {
    const used =
      events.some((event) => event.photoIds.includes(id) || event.attachmentIds.includes(id)) ||
      references.some((reference) => reference.fileIds.includes(id)) ||
      plan.some((item) => item.fileIds.includes(id))
    if (!used) await purgeDoc(db, 'files', id)
  }
}

export function TrashScreen() {
  const events = useLiveQuery(() => db.events.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const references = useLiveQuery(() => db.references.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const signs = useLiveQuery(() => db.folkSigns.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const items: TrashItem[] = [
    ...events.map((doc) => ({ collection: 'events' as const, doc, title: formatDate(doc.date), subtitle: doc.comment.slice(0, 80) })),
    ...references.map((doc) => ({ collection: 'references' as const, doc, title: doc.title, subtitle: 'статья' })),
    ...signs.map((doc) => ({ collection: 'folkSigns' as const, doc, title: folkSignDate(doc), subtitle: `народная примета: ${doc.title || doc.text.slice(0, 60)}` })),
  ].sort((a, b) => (b.doc.deletedAt ?? '').localeCompare(a.doc.deletedAt ?? ''))
  const [limit] = useState(() => Date.now() - TRASH_DAYS * 86_400_000)
  const old = items.filter((item) => Date.parse(item.doc.deletedAt ?? '') < limit)

  return (
    <Screen title="Корзина" help="trash" back="/more" tab="/more">
      <p className="hint">
        Удалённые записи хранятся здесь со всеми фото и связями и восстанавливаются одной кнопкой. «Удалить навсегда» убирает запись со всех устройств; её
        фото и файлы удаляются, если на них не ссылаются другие записи.
      </p>
      {old.length > 0 && (
        <div className="notice warning">
          <p>
            В корзине дольше {TRASH_DAYS} дней: {old.length}.
          </p>
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm(`Удалить навсегда ${old.length} записей, лежащих в корзине дольше ${TRASH_DAYS} дней? Восстановить их будет нельзя.`)) return
              for (const item of old) await purge(item)
            }}
          >
            Удалить их навсегда
          </ActionButton>
        </div>
      )}
      {items.length === 0 && <EmptyState>Корзина пуста.</EmptyState>}
      <ul className="list">
        {items.map((item) => (
          <li key={item.doc.id} className="list-row">
            <span>
              <strong>{item.title}</strong> <span className="muted">{item.subtitle}</span>
              <span className="small muted"> · удалено {new Date(item.doc.deletedAt ?? '').toLocaleDateString('ru-RU')}</span>
            </span>
            <span className="actions">
              <ActionButton secondary onRun={async () => void (await repo.restore(item.collection, item.doc.id, item.doc.revision))}>
                Восстановить
              </ActionButton>
              <ActionButton
                secondary
                onRun={async () => {
                  if (confirm('Удалить навсегда? Запись исчезнет со всех устройств, восстановить её будет нельзя.')) await purge(item)
                }}
              >
                Удалить навсегда
              </ActionButton>
            </span>
          </li>
        ))}
      </ul>
    </Screen>
  )
}
