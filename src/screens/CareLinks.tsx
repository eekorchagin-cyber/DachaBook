import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { repo, useSettings } from '../app/store'
import { withUse, withoutUse, type FertilizerLine } from '../domain/careLinks'
import { quantityText } from '../domain/consumables'
import type { Consumable } from '../domain/types'
import { db } from '../storage/db'
import { ActionButton } from '../ui/Section'
import { useFertilizerLines } from './useFertilizerLines'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru')

function groupHref(id: string, returnPath: string): string {
  return `#/objects?view=groups&group=${encodeURIComponent(id)}&back=${encodeURIComponent(returnPath)}`
}

function kindHref(kind: string, returnPath: string): string {
  return `#/dictionaries/work-kinds?kind=${encodeURIComponent(kind)}&back=${encodeURIComponent(returnPath)}`
}

function materialHref(id: string, returnPath: string): string {
  return `#/consumables?id=${encodeURIComponent(id)}&back=${encodeURIComponent(returnPath)}`
}

function amountText(line: FertilizerLine): string {
  if (line.need !== undefined) return `${quantityText(line.need, line.measureUnit)} за сезон`
  if (line.perUse !== undefined) return `на один раз ${quantityText(line.perUse, line.measureUnit)}`
  return 'Количество не посчитано'
}

/** Связка «группа растений — вид работ — расходный материал» и расчёт количества по площади группы. */
export function CareLinks({
  plantGroupId,
  workKind,
  consumableId,
  returnPath,
  draftArea,
  draftConsumable,
}: {
  plantGroupId?: string
  workKind?: string
  consumableId?: string
  /** Куда вернуться из соседней карточки, путь без #. */
  returnPath: string
  draftArea?: string
  draftConsumable?: Partial<Pick<Consumable, 'unit' | 'ratePerM2' | 'rateUnit' | 'packQuantity' | 'packUnit'>>
}) {
  const lines = useFertilizerLines({ plantGroupId, workKind, consumableId, draftArea, draftConsumable })
  const groups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt).toArray(), []) ?? []
  const materials = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const kinds = useSettings()?.workKinds ?? []
  const title = plantGroupId ? 'Виды работ и материалы' : workKind ? 'Группы растений и материалы' : 'Группы растений и виды работ'
  const here = { plantGroupId, workKind, consumableId }

  return (
    <section className="care-links">
      <h3 className="section-title">{title}</h3>
      <p className="hint">
        Связка считает, сколько материала нужно группе: площадь группы × норма на 1 м² × число внесений. Число внесений берётся из плана — это работы этого вида, в которых выбрана группа. Ссылки
        открывают остальные карточки связки.
      </p>
      {lines === undefined && <p className="hint">Загрузка…</p>}
      {lines?.length === 0 && <p className="hint">Связки пока нет, поэтому количество для группы не считается.</p>}
      {lines?.map((line) => (
        <CareLine key={`${line.plantGroupId}:${line.workKind}:${line.consumableId}`} line={line} here={here} returnPath={returnPath} />
      ))}
      <LinkForm plantGroupId={plantGroupId} workKind={workKind} consumableId={consumableId} groups={[...groups].sort(byName)} materials={[...materials].sort(byName)} kinds={kinds} />
    </section>
  )
}

function CareLine({
  line,
  here,
  returnPath,
}: {
  line: FertilizerLine
  here: { plantGroupId?: string; workKind?: string; consumableId?: string }
  returnPath: string
}) {
  const materialName = line.active ? line.name : `${line.name} (архив)`
  const bits: { key: string; href: string; label: string }[] = []
  if (!here.plantGroupId) bits.push({ key: 'group', href: groupHref(line.plantGroupId, returnPath), label: `Группа «${line.groupName}»` })
  if (!here.workKind) bits.push({ key: 'kind', href: kindHref(line.workKind, returnPath), label: `Вид работ «${line.workKind}»` })
  if (!here.consumableId) bits.push({ key: 'material', href: materialHref(line.consumableId, returnPath), label: `Материал «${materialName}»` })
  const remove = async () => {
    if (!confirm(`Убрать связку «${line.groupName} — ${line.workKind} — ${line.name}»? Для этой группы материал больше не посчитается.`)) return
    const item = await db.consumables.get(line.consumableId)
    if (!item) return
    await repo.update('consumables', item.id, { plantUses: withoutUse(item.plantUses ?? [], { plantGroupId: line.plantGroupId, workKind: line.workKind }) }, item.revision)
  }
  return (
    <div className="care-link">
      <p className="care-amount">{amountText(line)}</p>
      <p>
        {bits.map((bit, index) => (
          <span key={bit.key}>
            {index > 0 && ' · '}
            <a className="source-link" href={bit.href}>
              {bit.label}
            </a>
          </span>
        ))}
      </p>
      {line.formula && <p className="hint">{line.formula}</p>}
      {line.times > 0 && <p className="small muted">Внесений по плану: {line.times}</p>}
      {line.warnings.map((warning) => (
        <p key={warning} className="hint">
          {warning}
        </p>
      ))}
      <div className="actions">
        <ActionButton secondary onRun={remove}>
          Убрать связку
        </ActionButton>
      </div>
    </div>
  )
}

function LinkForm({
  plantGroupId,
  workKind,
  consumableId,
  groups,
  materials,
  kinds,
}: {
  plantGroupId?: string
  workKind?: string
  consumableId?: string
  groups: { id: string; name: string; active: boolean }[]
  materials: { id: string; name: string; active: boolean }[]
  kinds: string[]
}) {
  const [groupId, setGroupId] = useState(plantGroupId ?? '')
  const [kind, setKind] = useState(workKind ?? '')
  const [materialId, setMaterialId] = useState(consumableId ?? '')
  const chosenGroup = plantGroupId || groupId
  const chosenKind = workKind || kind
  const chosenMaterial = consumableId || materialId
  const missingGroup = !plantGroupId && groups.length === 0
  const missingKind = !workKind && kinds.length === 0
  const missingMaterial = !consumableId && materials.length === 0

  const add = async () => {
    if (!chosenGroup || !chosenKind || !chosenMaterial) throw new Error('Выберите группу, вид работ и материал.')
    const item = await db.consumables.get(chosenMaterial)
    if (!item || item.deletedAt) throw new Error('Материал не найден.')
    const next = withUse(item.plantUses ?? [], { plantGroupId: chosenGroup, workKind: chosenKind })
    if (next.length === (item.plantUses ?? []).length) throw new Error('Такая связка уже есть.')
    await repo.update('consumables', item.id, { plantUses: next }, item.revision)
    if (!plantGroupId) setGroupId('')
    if (!workKind) setKind('')
    if (!consumableId) setMaterialId('')
  }

  if (missingGroup || missingKind || missingMaterial) {
    return (
      <p className="hint">
        {missingGroup && (
          <>
            Сначала добавьте группу растений. <a href="#/objects?view=groups">Открыть группы</a>.{' '}
          </>
        )}
        {missingMaterial && (
          <>
            Сначала добавьте расходный материал. <a href="#/consumables">Открыть материалы</a>.{' '}
          </>
        )}
        {missingKind && 'В справочнике нет видов работ.'}
      </p>
    )
  }

  return (
    <div className="calc-grid">
      {!plantGroupId && (
        <label className="field">
          Группа растений
          <select aria-label="Группа растений" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">Выберите группу</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.active ? group.name : `${group.name} (архив)`}
              </option>
            ))}
          </select>
        </label>
      )}
      {!workKind && (
        <label className="field">
          Вид работ
          <select aria-label="Вид работ" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Выберите вид</option>
            {kinds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
      {!consumableId && (
        <label className="field">
          Расходный материал
          <select aria-label="Расходный материал" value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
            <option value="">Выберите материал</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.active ? item.name : `${item.name} (архив)`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="actions span">
        <ActionButton onRun={add}>Связать</ActionButton>
      </div>
    </div>
  )
}

