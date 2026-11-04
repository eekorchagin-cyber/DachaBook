import { useLiveQuery } from 'dexie-react-hooks'
import { removeUnit, removeWorkKind, renameUnit, renameWorkKind } from '../app/dictionaries'
import { localPath, navigate } from '../app/router'
import { DEFAULT_SETTINGS, getSetting, repo, setSetting, type AppSettings } from '../app/store'
import { db } from '../storage/db'
import { ListEditor } from '../ui/ListEditor'
import { EmptyState, Screen } from '../ui/Screen'
import { CareLinks } from './CareLinks'

async function removeDictionaryItem(key: 'consumableKinds' | 'workConditions', item: string): Promise<boolean> {
  await setSetting(key, (await getSetting(key)).filter((entry) => entry !== item))
  return true
}

async function renameConsumableKind(from: string, to: string): Promise<boolean> {
  const items = await db.consumables.filter((item) => item.kind === from).toArray()
  for (const item of items) await repo.update('consumables', item.id, { kind: to }, item.revision)
  await setSetting('consumableKinds', (await getSetting('consumableKinds')).map((item) => (item === from ? to : item)))
  return true
}

async function renameWorkCondition(from: string, to: string): Promise<boolean> {
  const works = await db.planWorks.filter((work) => work.condition?.type === 'label' && work.condition.text === from).toArray()
  for (const work of works) await repo.update('planWorks', work.id, { condition: { type: 'label', text: to } }, work.revision)
  await setSetting('workConditions', (await getSetting('workConditions')).map((item) => (item === from ? to : item)))
  return true
}

/** Перечень справочников: каждый открывается своим экраном. */
export function DictionariesScreen({ settings }: { settings: AppSettings }) {
  const counts = useLiveQuery(async () => ({
    consumables: await db.consumables.filter((item) => !item.deletedAt && item.active).count(),
  }))
  const items = [
    { href: '#/dictionaries/work-kinds', title: 'Виды работ', text: 'Стрижка газона, полив, внесение удобрений… — выбор в записях работ', count: settings.workKinds.length },
    { href: '#/dictionaries/consumable-kinds', title: 'Виды расходных материалов', text: 'Удобрение, горюче-смазочные, бытовая химия — без остатков и норм', count: settings.consumableKinds.length },
    { href: '#/dictionaries/units', title: 'Единицы измерения расходных материалов', text: 'кг, л, шт. — для норм и расхода материалов', count: settings.consumableUnits.length },
    { href: '#/consumables', title: 'Расходные материалы', text: 'Удобрения, средства, масло, уксус: нормы и описания', count: counts?.consumables },
    { href: '#/dictionaries/work-conditions', title: 'Условия для проведения работ', text: 'Подпись к работе. День сама не назначает', count: settings.workConditions.length },
  ].sort((a, b) => a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }))
  return (
    <Screen title="Справочники" help="dictionaries" back="/more" tab="/more">
      <p className="hint">Списки, из которых выбираются значения в записях дневника. Нажмите на справочник, чтобы открыть и изменить его.</p>
      <ul className="list">
        {items.map((item) => (
          <li key={item.href}>
            <a className="list-item" href={item.href}>
              <strong>
                {item.title}
                {item.count !== undefined && <span className="muted"> · {item.count}</span>}
              </strong>
              <span className="muted">{item.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </Screen>
  )
}

function WorkKindScreen({ name, known, returnTo }: { name: string; known: boolean; returnTo?: string }) {
  return (
    <Screen title={name} help="dictionaries" onBack={() => navigate(returnTo ?? '/dictionaries/work-kinds')} tab="/more">
      {!known && <p className="hint">Этого вида нет в списке справочника. Связки ниже всё ещё считаются, пока их не уберут.</p>}
      <CareLinks workKind={name} returnPath={`/dictionaries/work-kinds?kind=${encodeURIComponent(name)}`} />
    </Screen>
  )
}

export function DictionaryScreen({ kind, settings, query }: { kind: string; settings: AppSettings; query: URLSearchParams }) {
  if (kind === 'work-kinds') {
    const selected = query.get('kind')
    if (selected) return <WorkKindScreen name={selected} known={settings.workKinds.includes(selected)} returnTo={localPath(query.get('back'))} />
    return (
      <Screen title="Виды работ" help="dictionaries" back="/dictionaries" tab="/more">
        <p className="hint">
          Нажмите на название, чтобы переименовать его (Enter — сохранить, Esc — отменить): вид работы изменится и во всех записях дневника, в плане и в связках с
          материалами. Убранный вид останется в старых записях. «Связи» открывает группы и материалы этого вида. Список и выпадающие списки идут по алфавиту.
        </p>
        <ListEditor
          label="Виды работ"
          items={settings.workKinds}
          defaults={DEFAULT_SETTINGS.workKinds.filter((item) => !settings.workKindRenames[item])}
          placeholder="Новый вид работы, например «Мульчирование»"
          onSave={(items) => setSetting('workKinds', items)}
          onRename={renameWorkKind}
          onRemove={removeWorkKind}
          hrefFor={(item) => `#/dictionaries/work-kinds?kind=${encodeURIComponent(item)}`}
          hrefLabel="Связи"
        />
      </Screen>
    )
  }
  if (kind === 'consumable-kinds') {
    return (
      <Screen title="Виды расходных материалов" help="dictionaries" back="/dictionaries" tab="/more">
        <p className="hint">Короткий список видов: удобрение, масло, уксус. Остатки и нормы здесь не считаются — они в карточке материала и в работе.</p>
        <ListEditor
          label="Виды расходных материалов"
          items={settings.consumableKinds}
          defaults={DEFAULT_SETTINGS.consumableKinds}
          placeholder="Новый вид, например «Мульча»"
          onSave={(items) => setSetting('consumableKinds', items)}
          onRename={(from, to) => renameConsumableKind(from, to)}
          onRemove={(item) => removeDictionaryItem('consumableKinds', item)}
        />
      </Screen>
    )
  }
  if (kind === 'work-conditions') {
    return (
      <Screen title="Условия для проведения работ" help="dictionaries" back="/dictionaries" tab="/more">
        <p className="hint">
          Текст, который можно выбрать в годовой работе. «Как только просохнет почва после таяния снега» остаётся подписью: программа не назначает день, пока для такого условия нет правила погоды.
          Заморозки по-прежнему считаются отдельно, в карточке работы.
        </p>
        <ListEditor
          label="Условия для проведения работ"
          items={settings.workConditions}
          defaults={DEFAULT_SETTINGS.workConditions}
          placeholder="Новое условие"
          onSave={(items) => setSetting('workConditions', items)}
          onRename={(from, to) => renameWorkCondition(from, to)}
          onRemove={(item) => removeDictionaryItem('workConditions', item)}
        />
      </Screen>
    )
  }
  if (kind === 'units') {
    return (
      <Screen title="Единицы измерения расходных материалов" help="dictionaries" back="/dictionaries" tab="/more">
        <p className="hint">Единицы для норм и расхода материалов. Переименование меняет единицу и у материалов; количества не пересчитываются.</p>
        <ListEditor
          label="Единицы расходных материалов"
          items={settings.consumableUnits}
          defaults={DEFAULT_SETTINGS.consumableUnits}
          placeholder="Новая единица, например «мешок»"
          onSave={(items) => setSetting('consumableUnits', items)}
          onRename={renameUnit}
          onRemove={removeUnit}
        />
      </Screen>
    )
  }
  return (
    <Screen title="Справочники" back="/dictionaries" tab="/more">
      <EmptyState>Такого справочника нет.</EmptyState>
    </Screen>
  )
}
