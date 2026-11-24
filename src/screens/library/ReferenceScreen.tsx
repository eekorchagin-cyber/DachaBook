import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate } from '../../app/router'
import { pageLink } from '../../domain/labelProgram'
import { repo } from '../../app/store'
import type { DocInput, ReferenceMaterial } from '../../domain/types'
import { addAttachment } from '../../files/files'
import { errorText } from '../../lib/format'
import { htmlToText, textToHtml } from '../../lib/sanitize'
import { db } from '../../storage/db'
import { AttachmentRow } from '../../ui/AttachmentRow'
import { CopyLinkButton } from '../../ui/CopyLinkButton'
import { LeaveDirtyDialog } from '../../ui/LeaveDirtyDialog'
import { Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'
import { ReferenceBody } from './ReferenceBody'

function useMaterial(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.references.get(id)) ?? null) : null), [id])
}

export function ReferenceView({ id }: { id: string }) {
  const material = useMaterial(id)
  const objects = useLiveQuery(() => db.objects.toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.toArray(), []) ?? []
  if (material === undefined) return null
  if (!material) {
    return (
      <Screen title="Статьи" back="/library" tab="/library">
        <p className="empty">Статья не найдена.</p>
      </Screen>
    )
  }
  const links = [...material.objectIds.map((item) => objects.find((o) => o.id === item)?.name), ...material.plantGroupIds.map((item) => groups.find((g) => g.id === item)?.name)].filter(Boolean)
  return (
    <Screen title={material.title} help="library" back="/library" tab="/library">
      <div className="actions">
        <a className="button secondary" href={`#/library/${material.id}/edit`}>
          Изменить
        </a>
      </div>
      {(material.tags.length > 0 || links.length > 0) && (
        <p className="muted small">{[material.tags.join(', '), links.join(', ')].filter(Boolean).join(' · ')}</p>
      )}
      <article className="card">
        <ReferenceBody html={material.html} />
        <CopyLinkButton link={pageLink(`/library/${material.id}`)} />
      </article>
      {material.fileIds.length > 0 && (
        <section className="card">
          <h2>Вложения</h2>
          <ul className="list">
            {material.fileIds.map((fileId) => (
              <AttachmentRow key={fileId} id={fileId} />
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">
        Добавил(а): {material.createdBy}. Изменил(а): {material.updatedBy}, {new Date(material.updatedAt).toLocaleString('ru-RU')}.
        {material.source && ' Импортировано из Evernote.'}
      </p>
    </Screen>
  )
}

interface Draft {
  title: string
  text: string
  tags: string
  objectIds: string[]
  plantGroupIds: string[]
  fileIds: string[]
}

function toDraft(material?: ReferenceMaterial): Draft {
  return {
    title: material?.title ?? '',
    text: material ? htmlToText(material.html) : '',
    tags: material?.tags.join(', ') ?? '',
    objectIds: material?.objectIds ?? [],
    plantGroupIds: material?.plantGroupIds ?? [],
    fileIds: material?.fileIds ?? [],
  }
}

export function ReferenceEditor({ id }: { id?: string }) {
  const material = useMaterial(id)
  if (material === undefined) return null
  return <ReferenceForm key={material?.id ?? 'new'} material={material ?? undefined} />
}

function ReferenceForm({ material }: { material?: ReferenceMaterial }) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const [draft, setDraft] = useState<Draft>(() => toDraft(material))
  const [initial, setInitial] = useState(() => JSON.stringify(toDraft(material)))
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(0)
  const [leavePath, setLeavePath] = useState<string | null>(null)
  const dirty = useMemo(() => JSON.stringify(draft) !== initial, [draft, initial])
  /** Импортированная статья хранит оформление; её текст правится только вместе с потерей оформления. */
  const formatted = !!material?.source
  const [editBody, setEditBody] = useState(!formatted)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const toggle = (key: 'objectIds' | 'plantGroupIds', value: string) =>
    update({ [key]: draft[key].includes(value) ? draft[key].filter((item) => item !== value) : [...draft[key], value] })
  const back = material ? `/library/${material.id}` : '/library'
  const go = (path: string) => {
    setInitial(JSON.stringify(draft))
    setLeavePath(null)
    navigate(path)
  }
  const requestLeave = (path: string) => {
    if (!dirty) go(path)
    else setLeavePath(path)
  }

  const save = async (afterPath?: string) => {
    setError(null)
    try {
      const input: DocInput<ReferenceMaterial> = {
        title: draft.title.trim(),
        html: editBody ? textToHtml(draft.text) : (material?.html ?? ''),
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        objectIds: draft.objectIds,
        plantGroupIds: draft.plantGroupIds,
        fileIds: draft.fileIds,
        source: material?.source,
      }
      const saved = material ? await repo.update('references', material.id, input, material.revision) : await repo.create('references', input)
      setInitial(JSON.stringify(draft))
      setLeavePath(null)
      navigate(afterPath ?? `/library/${saved.id}`)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const addFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    setProcessing((count) => count + list.length)
    for (const file of list) {
      try {
        const stored = await addAttachment(file, file.name)
        setDraft((current) => (current.fileIds.includes(stored.id) ? current : { ...current, fileIds: [...current.fileIds, stored.id] }))
      } catch (caught) {
        setError(`Не удалось добавить «${file.name}»: ${errorText(caught)}`)
      } finally {
        setProcessing((count) => count - 1)
      }
    }
  }

  return (
    <Screen
      title={material ? 'Изменить статью' : 'Новая статья'}
      help="library"
      back={back}
      tab="/library"
      onBack={() => requestLeave(back)}
      leaveGuard={(path) => requestLeave(path)}
    >
      <section className="card">
        <label className="field">
          Заголовок
          <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
        </label>
        {editBody ? (
          <label className="field">
            Текст
            <textarea rows={10} value={draft.text} onChange={(event) => update({ text: event.target.value })} />
          </label>
        ) : (
          <div className="hint">
            <p>Текст импортирован из Evernote с оформлением, картинками и таблицами — он хранится как есть.</p>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                if (confirm('Перейти к правке текста? Оформление, таблицы и картинки в тексте будут потеряны, вложения останутся.')) setEditBody(true)
              }}
            >
              Править текст (без оформления)
            </button>
          </div>
        )}
        <label className="field">
          Метки через запятую
          <input value={draft.tags} placeholder="газон, удобрения" onChange={(event) => update({ tags: event.target.value })} />
        </label>
        <fieldset className="chips">
          <legend>К чему относится</legend>
          {objects.map((item) => (
            <label key={item.id} className={draft.objectIds.includes(item.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={draft.objectIds.includes(item.id)} onChange={() => toggle('objectIds', item.id)} />
              {item.name}
            </label>
          ))}
          {groups.map((item) => (
            <label key={item.id} className={draft.plantGroupIds.includes(item.id) ? 'chip active' : 'chip'}>
              <input type="checkbox" checked={draft.plantGroupIds.includes(item.id)} onChange={() => toggle('plantGroupIds', item.id)} />
              {item.name}
            </label>
          ))}
        </fieldset>
      </section>
      <section className="card">
        <h2>Вложения</h2>
        {draft.fileIds.length > 0 && (
          <ul className="list">
            {draft.fileIds.map((fileId) => (
              <AttachmentRow key={fileId} id={fileId} onRemove={() => update({ fileIds: draft.fileIds.filter((item) => item !== fileId) })} />
            ))}
          </ul>
        )}
        <div className="actions">
          <label className="button secondary">
            Добавить файл (PDF, таблица, фото…)
            <input type="file" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
          </label>
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton disabled={!draft.title.trim() || !dirty || processing > 0} onRun={() => save()}>
          Сохранить
        </ActionButton>
        {processing > 0 && <span className="hint">Обрабатываются файлы ({processing})…</span>}
        <button type="button" className="button secondary" onClick={() => requestLeave(back)}>
          {dirty ? 'Отмена' : 'Закрыть'}
        </button>
        {material && (
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm('Переместить статью в корзину? Её можно будет восстановить.')) return
              await repo.remove('references', material.id, material.revision)
              navigate('/library')
            }}
          >
            В корзину
          </ActionButton>
        )}
      </div>
      {leavePath &&
        createPortal(
          <LeaveDirtyDialog
            onChoice={(choice) => {
              if (choice === 'stay') setLeavePath(null)
              else if (choice === 'discard') go(leavePath)
              else void save(leavePath)
            }}
          />,
          document.body,
        )}
    </Screen>
  )
}
