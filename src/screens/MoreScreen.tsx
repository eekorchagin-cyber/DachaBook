import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { repo } from '../app/store'
import { formatDate } from '../domain/dates'
import type { Consumable, DiaryEvent, FolkSign, ReferenceMaterial } from '../domain/types'
import { folkSignDate } from '../import/folkSigns'
import { db } from '../storage/db'
import { purgeDoc } from '../sync/engine'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const TOP = [
  { href: '#/guide', title: 'Как пользоваться DachaBook' },
  { href: '#/more/works', title: 'Настройки работ' },
  { href: '#/dictionaries', title: 'Справочники' },
  { href: '#/more/program', title: 'Настройки программы' },
  { href: '#/more/service', title: 'Сервис' },
  { href: '#/trash', title: 'Корзина' },
]

const WORKS = [
  { href: '#/works', title: 'План работ' },
  { href: '#/watering', title: 'Полив' },
]

const PROGRAM = [
  { href: '#/settings?part=account', title: 'Учётная запись' },
  { href: '#/settings?part=plot', title: 'Участок' },
  { href: '#/more/users', title: 'Пользователи' },
  { href: '#/settings?part=appearance', title: 'Внешний вид программы' },
  { href: '#/more/cloud', title: 'Облако и резервное копирование' },
]

const CLOUD = [
  { href: '#/sync', title: 'Яндекс Диск' },
  { href: '#/backup', title: 'Резервная копия' },
  { href: '#/more/clouds', title: 'Другие облака' },
]

const SERVICE = [
  { href: '#/share', title: 'Фото в дневник' },
  { href: '#/diary/book', title: 'Дневник в PDF' },
  { href: '#/more/evernote', title: 'Evernote' },
  { href: '#/lab', title: 'Лаборатория проверок (служебная)' },
  { href: '#/settings?part=updates', title: 'Проверка обновлений' },
]

const EVERNOTE = [
  { href: '#/import', title: 'Импорт из Evernote' },
  { href: '#/archive', title: 'Архив импорта' },
  { href: '#/plan', title: 'Черновик плана из Evernote' },
]

function LinkList({ items }: { items: { href: string; title: string }[] }) {
  return (
    <ul className="list">
      {items.map((link) => (
        <li key={link.href}>
          <a className="list-item" href={link.href}>
            <strong>{link.title}</strong>
          </a>
        </li>
      ))}
    </ul>
  )
}

function Menu({ title, back, items }: { title: string; back: string; items: { href: string; title: string }[] }) {
  return (
    <Screen title={title} help="more" back={back} tab="/more">
      <LinkList items={items} />
    </Screen>
  )
}

export function MoreScreen({ page }: { page?: string }) {
  if (page === 'works') return <Menu title="Настройки работ" back="/more" items={WORKS} />
  if (page === 'program') return <Menu title="Настройки программы" back="/more" items={PROGRAM} />
  if (page === 'cloud') return <Menu title="Облако и резервное копирование" back="/more/program" items={CLOUD} />
  if (page === 'service') return <Menu title="Сервис" back="/more" items={SERVICE} />
  if (page === 'evernote') return <Menu title="Evernote" back="/more/service" items={EVERNOTE} />
  if (page === 'users') {
    return (
      <Screen title="Пользователи" help="more" back="/more/program" tab="/more">
        <p className="hint">Общий дневник нескольких людей появится на следующих этапах. Сейчас записи подписываются одним именем — оно задаётся в учётной записи.</p>
        <a className="button secondary" href="#/settings?part=account">
          Учётная запись
        </a>
      </Screen>
    )
  }
  if (page === 'clouds') {
    return (
      <Screen title="Другие облака" help="more" back="/more/cloud" tab="/more">
        <p className="hint">Кроме Яндекс Диска другие облака пока не подключены. Дневник можно хранить в файле резервной копии.</p>
        <div className="actions">
          <a className="button secondary" href="#/sync">
            Яндекс Диск
          </a>
          <a className="button secondary" href="#/backup">
            Резервная копия
          </a>
        </div>
      </Screen>
    )
  }
  if (page) {
    return (
      <Screen title="Ещё" help="more" back="/more" tab="/more">
        <EmptyState>Такого раздела нет.</EmptyState>
      </Screen>
    )
  }
  return (
    <Screen title="Ещё" help="more" tab="/more">
      <LinkList items={TOP} />
    </Screen>
  )
}

const TRASH_DAYS = 30

interface TrashItem {
  collection: 'events' | 'references' | 'folkSigns' | 'consumables'
  doc: DiaryEvent | ReferenceMaterial | FolkSign | Consumable
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
  const objects = await db.objects.toArray()
  const groups = await db.plantGroups.toArray()
  const works = await db.planWorks.toArray()
  for (const id of fileIds) {
    const used =
      events.some((event) => event.photoIds.includes(id) || event.attachmentIds.includes(id)) ||
      references.some((reference) => reference.fileIds.includes(id)) ||
      plan.some((item) => item.fileIds.includes(id)) ||
      objects.some((object) => object.photoIds?.includes(id)) ||
      groups.some((group) => group.photoIds?.includes(id)) ||
      works.some((work) => work.photoIds?.includes(id))
    if (!used) await purgeDoc(db, 'files', id)
  }
}

export function TrashScreen() {
  const events = useLiveQuery(() => db.events.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const references = useLiveQuery(() => db.references.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const signs = useLiveQuery(() => db.folkSigns.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !!item.deletedAt).toArray(), []) ?? []
  const items: TrashItem[] = [
    ...events.map((doc) => ({ collection: 'events' as const, doc, title: formatDate(doc.date), subtitle: doc.comment.slice(0, 80) })),
    ...references.map((doc) => ({ collection: 'references' as const, doc, title: doc.title, subtitle: 'статья' })),
    ...signs.map((doc) => ({ collection: 'folkSigns' as const, doc, title: folkSignDate(doc), subtitle: `народная примета: ${doc.title || doc.text.slice(0, 60)}` })),
    ...consumables.map((doc) => ({ collection: 'consumables' as const, doc, title: doc.name, subtitle: 'расходный материал' })),
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
