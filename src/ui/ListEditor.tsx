import { useState } from 'react'
import { cleanItem, itemProblem, moveItem } from '../domain/dictionaries'

interface ListEditorProps {
  label: string
  items: string[]
  defaults: string[]
  placeholder: string
  onSave: (items: string[]) => Promise<void>
  onRename: (from: string, to: string) => Promise<boolean>
  onRemove: (item: string) => Promise<boolean>
}

function ItemRow(props: { item: string; items: string[]; index: number } & Pick<ListEditorProps, 'onSave' | 'onRename' | 'onRemove'>) {
  const { item, items, index } = props
  const [value, setValue] = useState(item)
  const [error, setError] = useState<string | null>(null)

  const commit = async () => {
    const next = cleanItem(value)
    if (next === item) return setValue(item)
    const problem = itemProblem(items, next, item)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    if (!(await props.onRename(item, next))) setValue(item)
  }

  return (
    <li className="dictionary-row">
      <input
        aria-label={`Пункт ${index + 1}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setValue(item)
            setError(null)
          }
        }}
      />
      <button type="button" className="icon-button" aria-label="Выше" disabled={index === 0} onClick={() => void props.onSave(moveItem(items, index, -1))}>
        ↑
      </button>
      <button type="button" className="icon-button" aria-label="Ниже" disabled={index === items.length - 1} onClick={() => void props.onSave(moveItem(items, index, 1))}>
        ↓
      </button>
      <button type="button" className="icon-button" aria-label={`Убрать «${item}»`} onClick={() => void props.onRemove(item)}>
        ×
      </button>
      {error && <span className="error">{error}</span>}
    </li>
  )
}

/** Редактор справочника: правка названия на месте (Enter — сохранить, Esc — отменить), порядок, удаление, добавление. */
export function ListEditor(props: ListEditorProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const missing = props.defaults.filter((item) => !itemProblem(props.items, item))

  const add = async () => {
    const problem = itemProblem(props.items, draft)
    if (problem) {
      setError(problem)
      return
    }
    await props.onSave([...props.items, cleanItem(draft)])
    setDraft('')
    setError(null)
  }

  return (
    <div className="dictionary">
      <ul className="dictionary-list" aria-label={props.label}>
        {props.items.map((item, index) => (
          <ItemRow key={item} item={item} items={props.items} index={index} onSave={props.onSave} onRename={props.onRename} onRemove={props.onRemove} />
        ))}
      </ul>
      <div className="dictionary-row">
        <input
          aria-label={`Новый пункт: ${props.label}`}
          placeholder={props.placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <button type="button" className="button secondary small" disabled={!draft.trim()} onClick={() => void add()}>
          Добавить
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {missing.length > 0 && (
        <button type="button" className="button secondary small" onClick={() => void props.onSave([...props.items, ...missing])}>
          Вернуть стандартные ({missing.length})
        </button>
      )}
    </div>
  )
}
