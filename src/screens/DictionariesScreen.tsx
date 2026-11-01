import { useLiveQuery } from 'dexie-react-hooks'
import { removeUnit, removeWorkKind, renameUnit, renameWorkKind } from '../app/dictionaries'
import { localPath, navigate } from '../app/router'
import { DEFAULT_SETTINGS, setSetting, type AppSettings } from '../app/store'
import { db } from '../storage/db'
import { ListEditor } from '../ui/ListEditor'
import { EmptyState, Screen } from '../ui/Screen'
import { CareLinks } from './CareLinks'

/** Перечень справочников: каждый открывается своим экраном. */
export function DictionariesScreen({ settings }: { settings: AppSettings }) {
  const counts = useLiveQuery(async () => ({
    objects: await db.objects.filter((item) => !item.deletedAt && item.active).count(),
    groups: await db.plantGroups.filter((item) => !item.deletedAt && item.active).count(),
    consumables: await db.consumables.filter((item) => !item.deletedAt && item.active).count(),
    signs: await db.folkSigns.filter((item) => !item.deletedAt).count(),
  }))
  const items = [
    { href: '#/dictionaries/work-kinds', title: 'Виды работ', text: 'Стрижка газона, полив, подкормка… — выбор в записях работ', count: settings.workKinds.length },
    { href: '#/dictionaries/units', title: 'Единицы расходных материалов', text: 'кг, л, шт. — для норм и расхода материалов', count: settings.consumableUnits.length },
    { href: '#/objects?from=dictionaries', title: 'Объекты и места', text: 'Газон, сад, грядки, места на участке', count: counts?.objects },
    { href: '#/objects?view=groups&from=dictionaries', title: 'Группы растений', text: 'Хвойные, ягодные кусты, гортензии…', count: counts?.groups },
    { href: '#/consumables', title: 'Расходные материалы', text: 'Удобрения, средства, семена: нормы, описания, ссылки', count: counts?.consumables },
    { href: '#/signs', title: 'Народные приметы', text: 'Приметы и советы по дням года', count: counts?.signs },
  ]
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
          Нажмите на пункт, чтобы переименовать его (Enter — сохранить, Esc — отменить): вид работы изменится и во всех записях дневника, в плане и в связках с
          материалами. Убранный вид останется в старых записях. «Связи» открывает группы растений и расходные материалы этого вида. Порядок здесь — порядок в
          выпадающих списках.
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
  if (kind === 'units') {
    return (
      <Screen title="Единицы материалов" help="dictionaries" back="/dictionaries" tab="/more">
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
