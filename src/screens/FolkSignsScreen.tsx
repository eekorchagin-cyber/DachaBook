import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { repo } from '../app/store'
import { MONTH_NAMES, todayMonthDay } from '../domain/dates'
import type { DocInput, FolkSign } from '../domain/types'
import { dayOfYear, folkSignDate, folkSignKey, parseFolkSigns, upcomingSigns } from '../import/folkSigns'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

const byDate = (a: FolkSign, b: FolkSign) => dayOfYear(a.month, a.day) - dayOfYear(b.month, b.day) || a.title.localeCompare(b.title, 'ru')

function useFolkSigns(): FolkSign[] | undefined {
  return useLiveQuery(async () => (await db.folkSigns.filter((sign) => !sign.deletedAt).toArray()).sort(byDate), [])
}

function SignText({ sign, link = false }: { sign: FolkSign; link?: boolean }) {
  return (
    <>
      {sign.title && <strong>{sign.title}. </strong>}
      {sign.text}
      {sign.source && (
        <span className="small muted">
          {' '}
          Источник:{' '}
          {link && sign.source.url ? (
            <a className="source-link" href={sign.source.url} target="_blank" rel="noopener noreferrer">
              {sign.source.title}
            </a>
          ) : (
            sign.source.title
          )}
        </span>
      )}
    </>
  )
}

/** Карточка на главном экране: примета на сегодня или ближайшая на неделе. */
export function TodaySignCard({ signs }: { signs: FolkSign[] }) {
  const today = todayMonthDay()
  const { signs: found, ahead } = upcomingSigns(signs, today)
  if (found.length === 0) return null
  return (
    <section className="card">
      <div className="card-header">
        <h2>{ahead === 0 ? 'Народная примета на сегодня' : `Народная примета: ${folkSignDate(found[0])}`}</h2>
        <a className="small source-link" href="#/signs">
          Все приметы
        </a>
      </div>
      {found.map((sign) => (
        <p key={sign.id}>
          <SignText sign={sign} link />
        </p>
      ))}
    </section>
  )
}

function SignForm({ sign, onClose }: { sign?: FolkSign; onClose: () => void }) {
  const today = todayMonthDay()
  const [month, setMonth] = useState(sign?.month ?? today.month)
  const [day, setDay] = useState(String(sign?.day ?? today.day))
  const [title, setTitle] = useState(sign?.title ?? '')
  const [text, setText] = useState(sign?.text ?? '')
  const [source, setSource] = useState(sign?.source?.title ?? '')
  const dayNumber = Number(day)
  const validDay = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= new Date(2024, month, 0).getDate()

  const save = async () => {
    const sourceTitle = source.trim()
    const input: DocInput<FolkSign> = {
      month,
      day: dayNumber,
      title: title.trim(),
      text: text.trim(),
      source: sourceTitle ? (sourceTitle === sign?.source?.title ? sign.source : { title: sourceTitle }) : undefined,
    }
    if (sign) await repo.update('folkSigns', sign.id, input, sign.revision)
    else await repo.create('folkSigns', input)
    onClose()
  }

  return (
    <section className="card">
      <h2>{sign ? 'Изменить примету' : 'Новая примета'}</h2>
      <div className="row">
        <label className="field">
          Месяц
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          День
          <input inputMode="numeric" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
      </div>
      <label className="field">
        Название дня (необязательно)
        <input placeholder="Например, «Арина-рассадница»" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        Примета или совет
        <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <label className="field">
        Источник (необязательно)
        <input value={source} onChange={(event) => setSource(event.target.value)} />
      </label>
      {!validDay && <p className="hint">Проверьте день месяца.</p>}
      <div className="actions">
        <ActionButton disabled={!validDay || !text.trim()} onRun={save}>
          Сохранить
        </ActionButton>
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
        {sign && (
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm('Переместить примету в корзину? Её можно будет восстановить.')) return
              await repo.remove('folkSigns', sign.id, sign.revision)
              onClose()
            }}
          >
            В корзину
          </ActionButton>
        )}
      </div>
    </section>
  )
}

export function FolkSignsScreen() {
  const signs = useFolkSigns()
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const today = todayMonthDay()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [editing])

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const parsed = parseFolkSigns(await file.text())
    if (parsed.length === 0) {
      setMessage('В файле не нашлось таблицы «| Дата | Описание приметы |» с датами вида «7 января».')
      return
    }
    const known = new Set((signs ?? []).map(folkSignKey))
    const fresh = parsed.filter((sign) => !known.has(folkSignKey(sign)))
    for (const sign of fresh) await repo.create('folkSigns', sign)
    setMessage(`Из файла «${file.name}»: добавлено ${fresh.length}, уже были ${parsed.length - fresh.length}.`)
  }

  if (editing) {
    return (
      <Screen title="Народные приметы" help="signs" back="/more" tab="/more">
        <SignForm key={editing.id ?? 'new'} sign={signs?.find((sign) => sign.id === editing.id)} onClose={() => setEditing(null)} />
      </Screen>
    )
  }

  const months = MONTH_NAMES.map((name, index) => ({ name, month: index + 1, signs: (signs ?? []).filter((sign) => sign.month === index + 1) })).filter((group) => group.signs.length > 0)

  return (
    <Screen title="Народные приметы" help="signs" back="/more" tab="/more">
      {signs && <TodaySignCard signs={signs} />}
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing({})}>
          + Добавить примету
        </button>
        <label className="button secondary">
          Загрузить из файла .md
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
        </label>
      </div>
      {message && <p className="notice">{message}</p>}
      <p className="hint">Фольклорный календарь по новому стилю. Сверяйте сроки работ с погодой, прогревом почвы и риском заморозков на участке.</p>
      {signs && signs.length === 0 && <EmptyState>Примет пока нет.</EmptyState>}
      {months.map((group) => (
        <section key={group.month}>
          <h2 className="section-title">{group.name}</h2>
          <ul className="list">
            {group.signs.map((sign) => (
              <li key={sign.id}>
                <button type="button" className={sign.month === today.month && sign.day === today.day ? 'list-item today' : 'list-item'} onClick={() => setEditing({ id: sign.id })}>
                  <strong>{folkSignDate(sign)}</strong>
                  <span>
                    <SignText sign={sign} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  )
}
