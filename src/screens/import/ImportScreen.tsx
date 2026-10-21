import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { repo, type AppSettings } from '../../app/store'
import { formatDate } from '../../domain/dates'
import { periodText } from '../../domain/labels'
import type { CareObject, PlantGroup } from '../../domain/types'
import { addAttachment, addPhoto } from '../../files/files'
import { parseEnexStream, type EnexNote } from '../../import/enex/parser'
import {
  defaultDecisions,
  eventExists,
  executeImport,
  existingIndex,
  noteKey,
  type EventDecision,
  type ExistingIndex,
  type ImportDecisions,
  type ImportResult,
  type PlanPart,
} from '../../import/execute'
import { makeParts } from '../../import/parts'
import { buildProposal, type EventCandidate, type ImportProposal, type PlanCandidate } from '../../import/proposal'
import { splitSentences, suggestParts } from '../../import/split'
import { SplitEditor } from '../../ui/SplitEditor'
import { errorText, formatBytes } from '../../lib/format'
import { db } from '../../storage/db'
import { Screen } from '../../ui/Screen'
import { ActionButton } from '../../ui/Section'

const PAGE = 60

interface Loaded {
  proposal: ImportProposal
  existing: ExistingIndex
  files: { name: string; size: number; notes: number }[]
}

function EventRow(props: {
  candidate: EventCandidate
  decision: EventDecision
  objects: CareObject[]
  groups: PlantGroup[]
  workKinds: string[]
  exists: boolean
  onChange: (patch: Partial<EventDecision>) => void
}) {
  const { candidate, decision } = props
  if (decision.parts && decision.parts.length > 1) {
    return (
      <li className={decision.include ? 'import-row' : 'import-row off'}>
        <label className="import-check">
          <input type="checkbox" checked={decision.include} onChange={(event) => props.onChange({ include: event.target.checked })} />
          <strong>{candidate.needsConfirmation ? `«${candidate.sources[0].row.rawDate}»` : formatDate(candidate.date!)}</strong>
          <span className="tag">разделено на {decision.parts.length}</span>
        </label>
        {candidate.needsConfirmation && (
          <label className="field">
            Дата
            <input type="date" value={decision.date ?? ''} onChange={(event) => props.onChange({ date: event.target.value, include: !!event.target.value })} />
          </label>
        )}
        <SplitEditor
          parts={decision.parts}
          onChange={(parts) => props.onChange({ parts })}
          onCancel={() => props.onChange({ parts: undefined })}
          objects={props.objects}
          groups={props.groups}
          workKinds={props.workKinds}
          hasMedia={candidate.mediaHashes.length > 0}
        />
      </li>
    )
  }
  const canSplitText = splitSentences(decision.text).length > 1
  return (
    <li className={decision.include ? 'import-row' : 'import-row off'}>
      <label className="import-check">
        <input type="checkbox" checked={decision.include} onChange={(event) => props.onChange({ include: event.target.checked })} />
        <strong>{candidate.needsConfirmation ? `«${candidate.sources[0].row.rawDate}»` : formatDate(candidate.date!)}</strong>
        {props.exists && <span className="tag">уже есть</span>}
        {candidate.typeSuggested && <span className="tag warn">работа по тексту</span>}
        {candidate.splittable && <span className="tag warn">можно разделить</span>}
        {candidate.sources.length > 1 && <span className="muted small">файлов: {new Set(candidate.sources.map((source) => source.fileName)).size}</span>}
      </label>
      {candidate.variants.length > 1 ? (
        <fieldset className="variants">
          <legend className="muted small">Близкие варианты текста — выберите:</legend>
          {candidate.variants.map((variant) => (
            <label key={variant}>
              <input type="radio" checked={decision.text === variant} onChange={() => props.onChange({ text: variant })} /> {variant}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="import-text">{candidate.text}</p>
      )}
      <div className="row compact">
        {candidate.needsConfirmation && (
          <label className="field">
            Дата
            <input type="date" value={decision.date ?? ''} onChange={(event) => props.onChange({ date: event.target.value, include: !!event.target.value })} />
          </label>
        )}
        <label className="field">
          Тип
          <select value={decision.type} onChange={(event) => props.onChange({ type: event.target.value as EventDecision['type'] })}>
            <option value="work">Работа</option>
            <option value="observation">Наблюдение</option>
          </select>
        </label>
        <label className="field">
          Место
          <select value={decision.objectId} onChange={(event) => props.onChange({ objectId: event.target.value })}>
            {props.objects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name}
              </option>
            ))}
          </select>
        </label>
        {decision.type === 'work' && (
          <label className="field">
            Вид работы
            <select value={decision.workKind ?? ''} onChange={(event) => props.onChange({ workKind: event.target.value || undefined })}>
              <option value="">Не указан</option>
              {props.workKinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {candidate.mediaHashes.length > 0 && <p className="muted small">Вложений: {candidate.mediaHashes.length}</p>}
      {canSplitText && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => props.onChange({ parts: makeParts(decision.text, props.objects, props.groups, decision.type === 'work') })}
        >
          Разделить на {splitSentences(decision.text).length} записи
        </button>
      )}
    </li>
  )
}

function PlanRow(props: {
  candidate: PlanCandidate
  include: boolean
  exists: boolean
  parts?: PlanPart[]
  onChange: (value: boolean) => void
  onParts: (parts: PlanPart[] | undefined) => void
}) {
  const { candidate, include, exists, onChange, parts } = props
  const sentences = splitSentences(candidate.text)
  return (
    <li className={include ? 'import-row' : 'import-row off'}>
      <label className="import-check">
        <input type="checkbox" checked={include} onChange={(event) => onChange(event.target.checked)} />
        <span>{candidate.itemType === 'work' ? '⚒' : '👁'}</span>
        <span className="muted small">{periodText(candidate.periods)}</span>
        {exists && <span className="tag">уже есть</span>}
        {candidate.splittable && !parts && <span className="tag warn">можно разделить</span>}
      </label>
      {parts && parts.length > 1 ? (
        <>
          <ol className="split-parts">
            {parts.map((part, index) => (
              <li key={index} className="split-part">
                <textarea rows={2} value={part.text} onChange={(event) => props.onParts(parts.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))} />
                <select value={part.itemType} onChange={(event) => props.onParts(parts.map((item, i) => (i === index ? { ...item, itemType: event.target.value as PlanPart['itemType'] } : item)))}>
                  <option value="work">Предложение работы</option>
                  <option value="observation">Типичное наблюдение</option>
                </select>
              </li>
            ))}
          </ol>
          <button type="button" className="button secondary small" onClick={() => props.onParts(undefined)}>
            Не разделять
          </button>
        </>
      ) : (
        <p className="import-text">{candidate.text}</p>
      )}
      {candidate.seasonsDone.length > 0 && <p className="muted small">Выполнялось в сезонах: {candidate.seasonsDone.join(', ')}</p>}
      {!parts && sentences.length > 1 && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => props.onParts(suggestParts(candidate.text, candidate.itemType === 'work').map((part) => ({ text: part.text, itemType: part.type })))}
        >
          Разделить на {sentences.length} позиции
        </button>
      )}
    </li>
  )
}

export function ImportScreen({ settings }: { settings: AppSettings }) {
  const objects = useLiveQuery(() => db.objects.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const groups = useLiveQuery(() => db.plantGroups.filter((item) => !item.deletedAt && item.active).toArray(), []) ?? []
  const [progress, setProgress] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [decisions, setDecisions] = useState<ImportDecisions | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [eventFilter, setEventFilter] = useState<'all' | 'suggested' | 'split' | 'existing'>('all')
  const [limit, setLimit] = useState(PAGE)

  const readFiles = async (list: FileList | null) => {
    const chosen = Array.from(list ?? [])
    if (chosen.length === 0) return
    setError(null)
    setResult(null)
    try {
      const files: { fileName: string; notes: EnexNote[] }[] = []
      for (const file of chosen) {
        const notes: EnexNote[] = []
        for await (const note of parseEnexStream(file.stream(), (p) => setProgress(`Чтение «${file.name}»: ${formatBytes(p.bytesRead)} из ${formatBytes(file.size)}`))) {
          notes.push(note)
        }
        files.push({ fileName: file.name, notes })
      }
      setProgress('Разбор заметок…')
      const proposal = buildProposal(files)
      const existing = await existingIndex(db)
      setLoaded({ proposal, existing, files: chosen.map((file, i) => ({ name: file.name, size: file.size, notes: files[i].notes.length })) })
      setDecisions(defaultDecisions(proposal, objects, existing))
    } catch (caught) {
      setError(`Не удалось разобрать файл: ${errorText(caught)}`)
    } finally {
      setProgress(null)
    }
  }

  const stats = useMemo(() => {
    if (!loaded || !decisions) return null
    const { proposal, existing } = loaded
    const confirm = proposal.events.filter((item) => item.needsConfirmation)
    const exact = proposal.events.filter((item) => !item.needsConfirmation)
    return {
      confirm,
      exact,
      existingEvents: exact.filter((item) => eventExists(item, existing)).length,
      chosenEvents: proposal.events.filter((item) => decisions.events[item.key]?.include).length,
      planLatest: proposal.plan.filter((item) => !item.fromPastOnly),
      planPast: proposal.plan.filter((item) => item.fromPastOnly),
      chosenPlan: proposal.plan.filter((item) => decisions.plan[item.key]).length,
      chosenNotes: proposal.notes.filter((item) => decisions.notes[noteKey(item)] === 'reference').length,
    }
  }, [loaded, decisions])

  if (result) {
    return (
      <Screen title="Импорт из Evernote" help="import" back="/more" tab="/more">
        <section className="card">
          <h2>Импорт завершён</h2>
          <ul>
            <li>Записей дневника: {result.events}</li>
            <li>Позиций черновика плана: {result.planItems}</li>
            <li>Справочных материалов: {result.references}</li>
            <li>Файлов (фото и вложения): {result.files}</li>
            <li>Позиций архива импорта: {result.archiveItems}</li>
          </ul>
          <p className="hint">Перед импортом сохранён снимок данных. Исходные строки и заметки, включая невыбранные, — в «Архиве импорта».</p>
          {result.errors.length > 0 && (
            <>
              <h3>Не импортировано ({result.errors.length})</h3>
              <ul className="small">
                {result.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            <a className="button" href="#/diary">
              Открыть дневник
            </a>
            <a className="button secondary" href="#/plan">
              Черновик плана
            </a>
            <a className="button secondary" href="#/archive">
              Архив импорта
            </a>
          </div>
        </section>
      </Screen>
    )
  }

  const setEvent = (key: string, patch: Partial<EventDecision>) =>
    setDecisions((current) => current && { ...current, events: { ...current.events, [key]: { ...current.events[key], ...patch } } })
  const setPlan = (key: string, value: boolean) => setDecisions((current) => current && { ...current, plan: { ...current.plan, [key]: value } })
  const setPlanParts = (key: string, parts: PlanPart[] | undefined) =>
    setDecisions((current) => {
      if (!current) return current
      const next = { ...current.planParts }
      if (parts) next[key] = parts
      else delete next[key]
      return { ...current, planParts: next }
    })

  return (
    <Screen title="Импорт из Evernote" help="import" back="/more" tab="/more">
      <section className="card">
        <h2>1. Файлы ENEX</h2>
        <p className="hint">
          Выгрузите блокноты в Evernote («Экспорт» → формат ENEX) и выберите один или несколько файлов. Файлы разбираются на этом устройстве; ничего
          не сохраняется до нажатия «Импортировать».
        </p>
        <div className="actions">
          <label className="button">
            Выбрать файлы
            <input type="file" multiple hidden onChange={(event) => void readFiles(event.target.files)} />
          </label>
        </div>
        {progress && <p className="hint">{progress}</p>}
        {error && <p className="error">{error}</p>}
        {loaded && (
          <ul className="small">
            {loaded.files.map((file) => (
              <li key={file.name}>
                {file.name} — {formatBytes(file.size)}, заметок: {file.notes}
              </li>
            ))}
          </ul>
        )}
      </section>

      {loaded && decisions && stats && (
        <>
          <section className="card">
            <h2>2. Что будет импортировано</h2>
            <ul>
              <li>
                Записи дневника: {stats.chosenEvents} из {loaded.proposal.events.length}
                {stats.existingEvents > 0 && ` (уже есть в дневнике: ${stats.existingEvents})`}
              </li>
              <li>Даты на подтверждение: {stats.confirm.length}</li>
              <li>
                Черновик плана: {stats.chosenPlan} (из шаблона {loaded.proposal.latestSeason ?? '—'}: {stats.planLatest.length}, только в прошлых годах:{' '}
                {stats.planPast.length})
              </li>
              <li>Справочные материалы: {stats.chosenNotes}</li>
            </ul>
            <p className="hint">Строки с флажком — работы, без флажка — наблюдения. Подсказки места и вида работы проверьте ниже.</p>
          </section>

          {stats.confirm.length > 0 && (
            <details className="card" open>
              <summary>
                <h2>Даты на подтверждение ({stats.confirm.length})</h2>
              </summary>
              <p className="hint">Дата записана нестандартно. Укажите или проверьте дату — запись будет создана только с отмеченной галочкой.</p>
              <ul className="import-list">
                {stats.confirm.map((candidate) => (
                  <EventRow
                    key={candidate.key}
                    candidate={candidate}
                    decision={decisions.events[candidate.key]}
                    objects={objects}
                    groups={groups}
                    workKinds={settings.workKinds}
                    exists={false}
                    onChange={(patch) => setEvent(candidate.key, patch)}
                  />
                ))}
              </ul>
            </details>
          )}

          <details className="card">
            <summary>
              <h2>Записи дневника ({stats.exact.length})</h2>
            </summary>
            <div className="segmented">
              {(
                [
                  ['all', 'Все'],
                  ['suggested', 'Работа по тексту'],
                  ['split', 'Можно разделить'],
                  ['existing', 'Уже есть'],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" className={eventFilter === value ? 'active' : ''} onClick={() => setEventFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            {(() => {
              const list = stats.exact.filter((candidate) =>
                eventFilter === 'suggested' ? candidate.typeSuggested : eventFilter === 'split' ? candidate.splittable : eventFilter === 'existing' ? eventExists(candidate, loaded.existing) : true,
              )
              return (
                <>
                  <ul className="import-list">
                    {list.slice(0, limit).map((candidate) => (
                      <EventRow
                        key={candidate.key}
                        candidate={candidate}
                        decision={decisions.events[candidate.key]}
                        objects={objects}
                        groups={groups}
                        workKinds={settings.workKinds}
                        exists={eventExists(candidate, loaded.existing)}
                        onChange={(patch) => setEvent(candidate.key, patch)}
                      />
                    ))}
                  </ul>
                  {list.length > limit && (
                    <button type="button" className="button secondary" onClick={() => setLimit((value) => value + PAGE)}>
                      Показать ещё ({list.length - limit})
                    </button>
                  )}
                </>
              )
            })()}
          </details>

          <details className="card">
            <summary>
              <h2>Черновик плана из шаблона {loaded.proposal.latestSeason} ({stats.planLatest.length})</h2>
            </summary>
            <ul className="import-list">
              {stats.planLatest.map((candidate) => (
                <PlanRow
                  key={candidate.key}
                  candidate={candidate}
                  include={decisions.plan[candidate.key]}
                  exists={loaded.existing.planKeys.has(candidate.key)}
                  parts={decisions.planParts[candidate.key]}
                  onChange={(value) => setPlan(candidate.key, value)}
                  onParts={(parts) => setPlanParts(candidate.key, parts)}
                />
              ))}
            </ul>
          </details>

          {stats.planPast.length > 0 && (
            <details className="card">
              <summary>
                <h2>Из прошлых лет ({stats.planPast.length})</h2>
              </summary>
              <p className="hint">Этих строк нет в последнем шаблоне. Отметьте, что добавить в черновик плана; остальное сохранится в архиве импорта.</p>
              <ul className="import-list">
                {stats.planPast.map((candidate) => (
                  <PlanRow
                    key={candidate.key}
                    candidate={candidate}
                    include={decisions.plan[candidate.key]}
                    exists={loaded.existing.planKeys.has(candidate.key)}
                    parts={decisions.planParts[candidate.key]}
                    onChange={(value) => setPlan(candidate.key, value)}
                    onParts={(parts) => setPlanParts(candidate.key, parts)}
                  />
                ))}
              </ul>
            </details>
          )}

          {loaded.proposal.notes.length > 0 && (
            <section className="card">
              <h2>Обычные заметки ({loaded.proposal.notes.length})</h2>
              <ul className="import-list">
                {loaded.proposal.notes.map((candidate) => {
                  const key = noteKey(candidate)
                  const size = candidate.note.resources.reduce((sum, resource) => sum + resource.size, 0)
                  return (
                    <li key={key} className="import-row">
                      <strong>{candidate.note.title}</strong>
                      <span className="muted small">
                        {' '}
                        вложений: {candidate.note.resources.length} ({formatBytes(size)})
                      </span>
                      <select
                        value={decisions.notes[key]}
                        onChange={(event) =>
                          setDecisions((current) => current && { ...current, notes: { ...current.notes, [key]: event.target.value as 'reference' | 'skip' } })
                        }
                      >
                        <option value="reference">В справочник</option>
                        <option value="skip">Пропустить (останется в архиве)</option>
                      </select>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {loaded.proposal.outsidePieces.length > 0 && (
            <details className="card">
              <summary>
                <h2>Вне таблиц: ссылки, заметки, вложения ({loaded.proposal.outsidePieces.length})</h2>
              </summary>
              <p className="hint">
                Фрагменты, стоявшие между таблицами месяцев. Каждый можно прикрепить к записи, над которой он стоял в Evernote (текст допишется к записи,
                картинки и файлы прикрепятся), или оставить в общем справочном материале.
              </p>
              <ul className="import-list">
                {loaded.proposal.outsidePieces.map((piece) => {
                  const target = decisions.outsideTargets[piece.key]
                  const setTarget = (value: 'reference' | 'above') =>
                    setDecisions((current) => current && { ...current, outsideTargets: { ...current.outsideTargets, [piece.key]: value } })
                  return (
                    <li key={piece.key} className="import-row">
                      <p className="import-text">{piece.text || 'без текста'}</p>
                      {piece.mediaHashes.length > 0 && (
                        <p className="muted small">
                          Вложения:{' '}
                          {piece.mediaHashes
                            .map((hash) => loaded.proposal.resources.get(hash)?.fileName ?? loaded.proposal.resources.get(hash)?.mime ?? 'файл')
                            .join(', ')}
                        </p>
                      )}
                      <label className="checkbox">
                        <input type="radio" checked={target === 'above'} disabled={!piece.above} onChange={() => setTarget('above')} />
                        {piece.above ? `К записи выше: «${piece.above.row.text.slice(0, 80)}»` : 'Записи выше нет (фрагмент в начале заметки)'}
                      </label>
                      <label className="checkbox">
                        <input type="radio" checked={target !== 'above'} onChange={() => setTarget('reference')} />В справочный материал
                      </label>
                    </li>
                  )
                })}
              </ul>
              <label className="checkbox">
                <input type="checkbox" checked={decisions.outside} onChange={(event) => setDecisions((current) => current && { ...current, outside: event.target.checked })} />
                Создать справочный материал «Дневники Evernote: ссылки и заметки вне таблиц» из фрагментов, оставленных в справочнике
              </label>
            </details>
          )}

          <div className="actions">
            <ActionButton
              onRun={async () => {
                if (!confirm(`Импортировать: записей ${stats.chosenEvents}, позиций плана ${stats.chosenPlan}, материалов ${stats.chosenNotes}? Перед импортом будет сохранён снимок данных.`)) return
                const done = await executeImport(loaded.proposal, decisions, {
                  repo,
                  database: db,
                  objects,
                  files: {
                    photo: async (blob, name) => (await addPhoto(blob, name)).id,
                    attachment: async (blob, name) => (await addAttachment(blob, name)).id,
                  },
                  onProgress: (count, all) => setProgress(`Импорт: ${count} из ${all}`),
                })
                setProgress(null)
                setResult(done)
              }}
            >
              Импортировать
            </ActionButton>
          </div>
          {progress && <p className="hint">{progress}</p>}
        </>
      )}
    </Screen>
  )
}
