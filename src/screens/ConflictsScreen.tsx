import { useLiveQuery } from 'dexie-react-hooks'
import { getSetting } from '../app/store'
import { formatDate } from '../domain/dates'
import type { DiaryEvent } from '../domain/types'
import type { ConflictRecord } from '../storage/db'
import { db } from '../storage/db'
import { canMerge, resolveConflict, type Resolution } from '../sync/conflicts'
import { syncNow } from '../sync/runner'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const COLLECTION_LABELS: Record<string, string> = {
  events: 'Запись дневника',
  objects: 'Объект',
  plantGroups: 'Группа растений',
  references: 'Статья',
  planDrafts: 'Позиция плана',
  importArchive: 'Архив импорта',
  consumables: 'Расходный материал',
  folkSigns: 'Народная примета',
  files: 'Файл',
}

function describe(doc: Record<string, unknown>): string {
  if ('purgedAt' in doc) return `Удалена окончательно (${doc.purgedBy as string}, ${new Date(doc.purgedAt as string).toLocaleString('ru-RU')})`
  const event = doc as unknown as DiaryEvent
  if (typeof event.comment === 'string' && event.date) {
    return [
      `${formatDate(event.date)}${event.time ? `, ${event.time}` : ''}`,
      event.workKind,
      event.comment,
      event.photoIds?.length ? `фото: ${event.photoIds.length}` : '',
      doc.deletedAt ? 'в корзине' : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const title = (doc.title ?? doc.name ?? doc.text ?? doc.fileName ?? '') as string
  return [title, doc.deletedAt ? 'в корзине' : ''].filter(Boolean).join(' · ')
}

function Version({ label, doc }: { label: string; doc: Record<string, unknown> }) {
  return (
    <div className="conflict-version">
      <strong>{label}</strong>
      <p className="event-text">{describe(doc)}</p>
      {'updatedAt' in doc && (
        <p className="small muted">
          Изменил(а): {doc.updatedBy as string}, {new Date(doc.updatedAt as string).toLocaleString('ru-RU')}
        </p>
      )}
    </div>
  )
}

function ConflictCard({ conflict }: { conflict: ConflictRecord }) {
  const resolve = async (choice: Resolution) => {
    await resolveConflict(db, conflict, choice, (await getSetting('authorName')) || 'Без имени')
    void syncNow()
  }
  return (
    <section className="card">
      <h2>{COLLECTION_LABELS[conflict.collection] ?? conflict.collection}</h2>
      <div className="conflict-versions">
        <Version label="На этом устройстве" doc={conflict.local} />
        <Version label="В облаке" doc={conflict.remote} />
      </div>
      <div className="actions">
        <ActionButton onRun={() => resolve('local')}>Оставить версию этого устройства</ActionButton>
        <ActionButton secondary onRun={() => resolve('remote')}>
          Взять версию из облака
        </ActionButton>
        {canMerge(conflict) && (
          <ActionButton secondary onRun={() => resolve('merge')}>
            Объединить
          </ActionButton>
        )}
      </div>
      {canMerge(conflict) && <p className="hint">«Объединить» соединяет тексты обеих версий, фото, файлы, места и расход материалов.</p>}
    </section>
  )
}

export function ConflictsScreen() {
  const conflicts = useLiveQuery(() => db.conflicts.orderBy('id').toArray(), [])
  return (
    <Screen title="Конфликты" help="sync" back="/sync" tab="/more">
      <p className="hint">
        Эти записи изменили и здесь, и на другом устройстве. Обе версии сохранены; выберите, какую оставить. Пока конфликт не решён, запись не
        отправляется в облако.
      </p>
      {conflicts && conflicts.length === 0 && <EmptyState>Конфликтов нет.</EmptyState>}
      {conflicts?.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} />
      ))}
    </Screen>
  )
}
