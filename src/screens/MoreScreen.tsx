import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../app/store'
import { formatDate } from '../domain/dates'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const LINKS = [
  { href: '#/plan', title: 'Черновик сезонного плана', text: 'Предложения работ и типичные наблюдения по месяцам' },
  { href: '#/import', title: 'Импорт из Evernote', text: 'Перенос дневников и заметок из файлов ENEX' },
  { href: '#/archive', title: 'Архив импорта', text: 'Исходные строки и заметки Evernote, в том числе неиспользованные' },
  { href: '#/trash', title: 'Корзина', text: 'Удалённые записи и материалы, восстановление' },
  { href: '#/backup', title: 'Резервная копия', text: 'Экспорт всех данных в файл и импорт из файла' },
  { href: '#/settings', title: 'Настройки', text: 'Имя, тема, размер текста' },
]

export function MoreScreen() {
  return (
    <Screen title="Ещё" tab="/more">
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

export function TrashScreen() {
  const events = useLiveQuery(() => db.events.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const references = useLiveQuery(() => db.references.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const empty = events.length === 0 && references.length === 0
  return (
    <Screen title="Корзина" back="/more" tab="/more">
      <p className="hint">Удалённые записи хранятся здесь со всеми фото и связями. Окончательное удаление появится вместе с синхронизацией (этап 3).</p>
      {empty && <EmptyState>Корзина пуста.</EmptyState>}
      <ul className="list">
        {events.map((event) => (
          <li key={event.id} className="list-row">
            <span>
              <strong>{formatDate(event.date)}</strong> <span className="muted">{event.comment.slice(0, 80)}</span>
            </span>
            <ActionButton secondary onRun={async () => void (await repo.restore('events', event.id, event.revision))}>
              Восстановить
            </ActionButton>
          </li>
        ))}
        {references.map((reference) => (
          <li key={reference.id} className="list-row">
            <span>
              <strong>{reference.title}</strong> <span className="muted">справочный материал</span>
            </span>
            <ActionButton secondary onRun={async () => void (await repo.restore('references', reference.id, reference.revision))}>
              Восстановить
            </ActionButton>
          </li>
        ))}
      </ul>
    </Screen>
  )
}
