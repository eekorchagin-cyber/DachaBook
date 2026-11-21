import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { repo } from '../app/store'
import { itemsFromPlanWorks, planWorksFromTemplate } from '../domain/planTemplates'
import type { PlanTemplate, PlanWork, PlantGroup } from '../domain/types'
import { errorText } from '../lib/format'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

function CreateTemplateForm({
  works,
  groups,
  onClose,
}: {
  works: PlanWork[]
  groups: PlantGroup[]
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'picks' | 'group'>('picks')
  const [picked, setPicked] = useState<string[]>([])
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [error, setError] = useState('')

  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const save = async () => {
    setError('')
    const title = name.trim()
    if (!title) {
      setError('Укажите название шаблона.')
      return
    }
    const selected =
      mode === 'group'
        ? works.filter((work) => work.plantGroupIds.includes(groupId))
        : works.filter((work) => picked.includes(work.id))
    if (selected.length === 0) {
      setError(mode === 'group' ? 'У выбранной группы нет работ в плане.' : 'Отметьте хотя бы одну работу.')
      return
    }
    const consumables = await db.consumables.toArray()
    await repo.create('planTemplates', {
      name: title,
      items: itemsFromPlanWorks(selected, consumables),
      active: true,
    })
    onClose()
  }

  return (
    <section className="card">
      <h2>Новый шаблон</h2>
      <label className="field">
        Название
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Томаты, газон…" />
      </label>
      <div className="jump-row" role="group" aria-label="Откуда взять работы">
        <button type="button" className={mode === 'picks' ? 'chip active' : 'chip'} onClick={() => setMode('picks')}>
          Отмеченные работы
        </button>
        <button type="button" className={mode === 'group' ? 'chip active' : 'chip'} onClick={() => setMode('group')}>
          Все работы группы
        </button>
      </div>
      {mode === 'picks' ? (
        <ul className="list">
          {works.map((work) => (
            <li key={work.id}>
              <label className="chip">
                <input type="checkbox" checked={picked.includes(work.id)} onChange={() => toggle(work.id)} />
                {work.title}
              </label>
            </li>
          ))}
        </ul>
      ) : groups.length === 0 ? (
        <p className="hint">Сначала заведите группы растений.</p>
      ) : (
        <label className="field">
          Группа растений
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton onRun={save}>Сохранить шаблон</ActionButton>
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

function ApplyTemplateForm({ template, groups, onClose }: { template: PlanTemplate; groups: PlantGroup[]; onClose: () => void }) {
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const toggle = (id: string) => setGroupIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))

  const apply = async () => {
    setError('')
    if (groupIds.length === 0) {
      setError('Выберите хотя бы одну группу растений.')
      return
    }
    const selected = groups.filter((group) => groupIds.includes(group.id))
    const objectIds = [...new Set(selected.flatMap((group) => group.objectIds ?? []))]
    const consumables = await db.consumables.filter((item) => !item.deletedAt).toArray()
    const inputs = planWorksFromTemplate(template, { plantGroupIds: groupIds, objectIds, consumables })
    for (const input of inputs) await repo.create('planWorks', input)
    alert(`Добавлено работ: ${inputs.length}.`)
    onClose()
  }

  return (
    <section className="card">
      <h2>Применить: {template.name}</h2>
      <p className="hint">В план добавятся {template.items.length} работ для выбранных групп. Нормы материалов подставятся по названию, если материал уже есть в справочнике.</p>
      {groups.length === 0 ? (
        <p className="hint">Нет групп растений.</p>
      ) : (
        <ul className="list">
          {groups.map((group) => (
            <li key={group.id}>
              <label className="chip">
                <input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => toggle(group.id)} />
                {group.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <ActionButton onRun={apply}>Применить</ActionButton>
        <button type="button" className="button secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </section>
  )
}

export function TemplatesScreen() {
  const templates = useLiveQuery(() => db.planTemplates.filter((item) => !item.deletedAt).toArray(), [])
  const works = useLiveQuery(() => db.planWorks.filter((work) => !work.deletedAt && work.active).toArray(), [])
  const groups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt && group.active).toArray(), [])
  const [creating, setCreating] = useState(false)
  const [applyId, setApplyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const list = useMemo(
    () => [...(templates ?? [])].filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [templates],
  )
  const applying = list.find((item) => item.id === applyId)
  const activeWorks = [...(works ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const activeGroups = [...(groups ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return (
    <Screen title="Шаблоны плана" help="templates" back="/more/works" tab="/more">
      <p className="hint">Сохраните набор плановых работ и примените его к другой группе растений. Это не энциклопедия культур, а ваш собственный снимок плана.</p>
      <div className="actions">
        <button type="button" className="button" onClick={() => { setCreating(true); setApplyId(null) }}>
          Создать из плана
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {creating && (
        <CreateTemplateForm
          works={activeWorks}
          groups={activeGroups}
          onClose={() => setCreating(false)}
        />
      )}
      {applying && (
        <ApplyTemplateForm template={applying} groups={activeGroups} onClose={() => setApplyId(null)} />
      )}
      {templates && list.length === 0 && !creating && <EmptyState>Шаблонов пока нет. Создайте из отмеченных работ плана или из всех работ группы.</EmptyState>}
      <ul className="list">
        {list.map((template) => (
          <li key={template.id} className="list-item">
            <strong>{template.name}</strong>
            <p className="small muted">Работ: {template.items.length}</p>
            <div className="actions">
              <button
                type="button"
                className="button small"
                onClick={() => {
                  setApplyId(template.id)
                  setCreating(false)
                }}
              >
                Применить
              </button>
              <ActionButton
                secondary
                onRun={async () => {
                  setError('')
                  try {
                    await repo.update('planTemplates', template.id, { active: false }, template.revision)
                  } catch (caught) {
                    setError(errorText(caught))
                  }
                }}
              >
                Скрыть
              </ActionButton>
              <ActionButton
                secondary
                onRun={async () => {
                  if (!confirm(`Удалить шаблон «${template.name}»?`)) return
                  setError('')
                  try {
                    await repo.remove('planTemplates', template.id, template.revision)
                  } catch (caught) {
                    setError(errorText(caught))
                  }
                }}
              >
                Удалить
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Screen>
  )
}
