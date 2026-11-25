import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { repo, useSettings } from '../app/store'
import { instructionApplications, replaceUse, withoutUse, withUse, type FertilizerLine } from '../domain/careLinks'
import { parseQuantity, quantityText } from '../domain/consumables'
import { todayAtSite } from '../domain/dates'
import type { Consumable, PlantUse } from '../domain/types'
import { db } from '../storage/db'
import { ActionButton } from '../ui/Section'
import { useFertilizerLines } from './useFertilizerLines'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru')

function groupLines(lines: FertilizerLine[]): FertilizerLine[][] {
  const groups = new Map<string, FertilizerLine[]>()
  for (const line of lines) {
    const list = groups.get(line.plantGroupId) ?? []
    list.push(line)
    groups.set(line.plantGroupId, list)
  }
  return [...groups.values()]
}

function groupHref(id: string, returnPath: string): string {
  return `#/objects?view=groups&group=${encodeURIComponent(id)}&back=${encodeURIComponent(returnPath)}`
}

function kindHref(kind: string, returnPath: string): string {
  return `#/dictionaries/work-kinds?kind=${encodeURIComponent(kind)}&back=${encodeURIComponent(returnPath)}`
}

function materialHref(id: string, returnPath: string): string {
  return `#/consumables?id=${encodeURIComponent(id)}&back=${encodeURIComponent(returnPath)}`
}

function perUseText(line: FertilizerLine): string {
  if (line.perUse !== undefined) return `${quantityText(line.perUse, line.measureUnit)} на 1 раз`
  return ''
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
  draftConsumable?: Partial<
    Pick<Consumable, 'unit' | 'ratePerM2' | 'rateUnit' | 'packQuantity' | 'packUnit' | 'applications' | 'instructionRecurrence' | 'instructionPeriods' | 'instructionSchedule'>
  >
}) {
  const lines = useFertilizerLines({ plantGroupId, workKind, consumableId, draftArea, draftConsumable })
  const groups = useLiveQuery(() => db.plantGroups.filter((group) => !group.deletedAt).toArray(), []) ?? []
  const materials = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const kinds = useSettings()?.workKinds ?? []
  const units = useSettings()?.consumableUnits ?? ['г', 'кг', 'мл', 'л']
  const title = plantGroupId ? 'Работы и материалы' : workKind ? workKind : 'Группы растений и виды работ'
  const here = { plantGroupId, workKind, consumableId }
  const storedMaterial = consumableId ? materials.find((item) => item.id === consumableId) : undefined
  const defaults: Partial<Consumable> | undefined = storedMaterial || draftConsumable ? { ...storedMaterial, ...draftConsumable } : undefined
  const instructionApps = defaults ? instructionApplications(defaults, todayAtSite().date) : undefined

  return (
    <section className="care-links">
      <h3 className="block-title">{title}</h3>
      <p className="hint">
        Потребность считают от группы растений: площадь группы × норма на 1 м² × сколько раз за сезон. Норма и кратность по умолчанию — из карточки материала (в том числе из графика инструкции), для каждой группы их можно изменить. Объект участка норму не задаёт.
      </p>
      {lines === undefined && <p className="hint">Загрузка…</p>}
      {lines?.length === 0 && <p className="hint">Связки пока нет, поэтому количество для группы не считается.</p>}
      {groupLines(lines ?? []).map((group) => (
        <div key={group[0].plantGroupId} className="care-link">
          {!plantGroupId && (
            <h4 className="care-group-name">
              <a className="source-link" href={groupHref(group[0].plantGroupId, returnPath)}>
                {group[0].groupName}
              </a>
            </h4>
          )}
          {group.map((line) => (
            <CareLine
              key={`${line.plantGroupId}:${line.workKind}:${line.consumableId}`}
              line={line}
              here={here}
              returnPath={returnPath}
              units={units}
              defaults={defaults}
              instructionApps={instructionApps}
            />
          ))}
        </div>
      ))}
      <LinkForm
        plantGroupId={plantGroupId}
        workKind={workKind}
        consumableId={consumableId}
        groups={[...groups].sort(byName)}
        materials={[...materials].sort(byName)}
        kinds={kinds}
        units={units}
        defaultRate={defaults?.ratePerM2}
        defaultRateUnit={defaults?.rateUnit ?? 'г'}
        defaultApplications={instructionApps}
      />
    </section>
  )
}

function CareLine({
  line,
  here,
  returnPath,
  units,
  defaults,
  instructionApps,
}: {
  line: FertilizerLine
  here: { plantGroupId?: string; workKind?: string; consumableId?: string }
  returnPath: string
  units: string[]
  defaults?: Partial<Pick<Consumable, 'ratePerM2' | 'rateUnit' | 'applications'>>
  instructionApps?: number
}) {
  const material = useLiveQuery(() => db.consumables.get(line.consumableId), [line.consumableId])
  const stored = material?.plantUses?.find((use: { plantGroupId: string; workKind: string }) => use.plantGroupId === line.plantGroupId && use.workKind === line.workKind)
  const defaultApps = stored?.applications ?? instructionApps
  const [rate, setRate] = useState(() => {
    const value = line.ratePerM2 ?? defaults?.ratePerM2
    return value !== undefined ? String(value) : ''
  })
  const [rateUnit, setRateUnit] = useState(() => line.rateUnit ?? defaults?.rateUnit ?? 'г')
  const [apps, setApps] = useState(() => (defaultApps !== undefined ? String(defaultApps) : ''))
  useEffect(() => {
    const nextRate = stored?.ratePerM2 ?? line.ratePerM2 ?? defaults?.ratePerM2
    setRate(nextRate !== undefined ? String(nextRate) : '')
    setRateUnit(stored?.rateUnit ?? line.rateUnit ?? defaults?.rateUnit ?? 'г')
    const nextApps = stored?.applications ?? instructionApps
    setApps(nextApps !== undefined ? String(nextApps) : '')
  }, [stored?.ratePerM2, stored?.rateUnit, stored?.applications, line.ratePerM2, line.rateUnit, defaults?.ratePerM2, defaults?.rateUnit, instructionApps])
  const materialName = line.active ? line.name : `${line.name} (архив)`
  const amount = perUseText(line)
  const bits: { key: string; href: string; label: string }[] = []
  if (!here.workKind) bits.push({ key: 'kind', href: kindHref(line.workKind, returnPath), label: `Вид работ «${line.workKind}»` })
  if (!here.consumableId) bits.push({ key: 'material', href: materialHref(line.consumableId, returnPath), label: amount ? `${materialName}, ${amount}` : materialName })

  const saveNorm = async () => {
    const item = await db.consumables.get(line.consumableId)
    if (!item) return
    const parsedRate = parseQuantity(rate)
    const parsedApps = apps.trim() ? Number(apps.trim()) : undefined
    if (apps.trim() && (!Number.isFinite(parsedApps) || (parsedApps ?? 0) < 1 || !Number.isInteger(parsedApps))) {
      throw new Error('Кратность — целое число раз за сезон, не меньше 1.')
    }
    const nextUse: PlantUse = {
      plantGroupId: line.plantGroupId,
      workKind: line.workKind,
      ratePerM2: parsedRate,
      rateUnit: parsedRate ? rateUnit.trim() || 'г' : undefined,
      applications: parsedApps ?? instructionApps,
    }
    await repo.update('consumables', item.id, { plantUses: replaceUse(item.plantUses ?? [], nextUse) }, item.revision)
  }

  const remove = async () => {
    if (!confirm(`Убрать связку «${line.groupName} — ${line.workKind} — ${line.name}»? Для этой группы материал больше не посчитается.`)) return
    const item = await db.consumables.get(line.consumableId)
    if (!item) return
    await repo.update('consumables', item.id, { plantUses: withoutUse(item.plantUses ?? [], { plantGroupId: line.plantGroupId, workKind: line.workKind }) }, item.revision)
  }

  return (
    <div className="care-line">
      {here.consumableId && <p className="care-amount">{amount || 'Количество на 1 раз не посчитано'}</p>}
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
      {line.times > 0 && (
        <p className="small muted">
          Внесений: {line.times}
          {line.instructedTimes ? ' (из инструкции связки)' : ' (по плану работ)'}
        </p>
      )}
      {line.warnings.map((warning) => (
        <p key={warning} className="hint">
          {warning}
        </p>
      ))}
      {here.consumableId && (
        <div className="calc-grid care-norm">
          <div className="field span">
            <span className="field-label">Норма на 1 м² для этой группы</span>
            <span className="measure-line">
              <input aria-label={`Норма ${line.groupName}`} inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
              <select aria-label={`Единица нормы ${line.groupName}`} value={rateUnit} onChange={(event) => setRateUnit(event.target.value)}>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <span className="suffix">/ м²</span>
            </span>
          </div>
          <label className="field">
            Раз за сезон
            <input
              aria-label={`Кратность ${line.groupName}`}
              inputMode="numeric"
              placeholder={instructionApps !== undefined ? String(instructionApps) : 'из инструкции'}
              value={apps}
              onChange={(event) => setApps(event.target.value)}
            />
          </label>
          {instructionApps !== undefined && !stored?.applications && (
            <p className="hint span">Подставлено из инструкции материала ({instructionApps}). Можно изменить и сохранить.</p>
          )}
          <div className="actions span">
            <ActionButton onRun={saveNorm}>Сохранить норму группы</ActionButton>
          </div>
        </div>
      )}
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
  units,
  defaultRate,
  defaultRateUnit,
  defaultApplications,
}: {
  plantGroupId?: string
  workKind?: string
  consumableId?: string
  groups: { id: string; name: string; active: boolean }[]
  materials: { id: string; name: string; active: boolean; ratePerM2?: number; rateUnit?: string; applications?: number }[]
  kinds: string[]
  units: string[]
  defaultRate?: number
  defaultRateUnit?: string
  defaultApplications?: number
}) {
  const [groupId, setGroupId] = useState(plantGroupId ?? '')
  const [kind, setKind] = useState(workKind ?? '')
  const [materialId, setMaterialId] = useState(consumableId ?? '')
  const [rate, setRate] = useState(() => (defaultRate !== undefined ? String(defaultRate) : ''))
  const [rateUnit, setRateUnit] = useState(defaultRateUnit ?? 'г')
  const [apps, setApps] = useState(() => (defaultApplications !== undefined ? String(defaultApplications) : ''))
  const chosenGroup = plantGroupId || groupId
  const chosenKind = workKind || kind
  const chosenMaterial = consumableId || materialId
  const missingGroup = !plantGroupId && groups.length === 0
  const missingKind = !workKind && kinds.length === 0
  const missingMaterial = !consumableId && materials.length === 0

  const pickMaterial = (id: string) => {
    setMaterialId(id)
    const item = materials.find((entry) => entry.id === id)
    if (!item) return
    if (!rate.trim() && item.ratePerM2 !== undefined) setRate(String(item.ratePerM2))
    if (item.rateUnit) setRateUnit(item.rateUnit)
    if (!apps.trim() && item.applications !== undefined) setApps(String(item.applications))
  }

  const add = async () => {
    if (!chosenGroup || !chosenKind || !chosenMaterial) throw new Error('Выберите группу, вид работ и материал.')
    const item = await db.consumables.get(chosenMaterial)
    if (!item || item.deletedAt) throw new Error('Материал не найден.')
    const parsedRate = parseQuantity(rate)
    const parsedApps = apps.trim() ? Number(apps.trim()) : undefined
    if (apps.trim() && (!Number.isFinite(parsedApps) || (parsedApps ?? 0) < 1 || !Number.isInteger(parsedApps))) {
      throw new Error('Кратность — целое число раз за сезон, не меньше 1.')
    }
    const use: PlantUse = {
      plantGroupId: chosenGroup,
      workKind: chosenKind,
      ratePerM2: parsedRate ?? item.ratePerM2,
      rateUnit: (parsedRate ?? item.ratePerM2) ? rateUnit.trim() || item.rateUnit || 'г' : undefined,
      applications: parsedApps ?? instructionApplications(item, todayAtSite().date),
    }
    const next = withUse(item.plantUses ?? [], use)
    if (next.length === (item.plantUses ?? []).length) throw new Error('Такая связка уже есть. Измените норму в карточке связки выше.')
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
          <select aria-label="Расходный материал" value={materialId} onChange={(event) => pickMaterial(event.target.value)}>
            <option value="">Выберите материал</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.active ? item.name : `${item.name} (архив)`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field span">
        <span className="field-label">Норма на 1 м² для группы</span>
        <span className="measure-line">
          <input aria-label="Норма новой связки" inputMode="decimal" placeholder="из материала" value={rate} onChange={(event) => setRate(event.target.value)} />
          <select aria-label="Единица нормы новой связки" value={rateUnit} onChange={(event) => setRateUnit(event.target.value)}>
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <span className="suffix">/ м²</span>
        </span>
      </div>
      <label className="field">
        Раз за сезон
        <input aria-label="Кратность новой связки" inputMode="numeric" placeholder="из плана или материала" value={apps} onChange={(event) => setApps(event.target.value)} />
      </label>
      <div className="actions span">
        <ActionButton onRun={add}>Связать</ActionButton>
      </div>
    </div>
  )
}
