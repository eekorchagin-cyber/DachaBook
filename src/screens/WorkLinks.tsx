import { useLiveQuery } from 'dexie-react-hooks'
import type { FertilizerLine } from '../domain/careLinks'
import { quantityText } from '../domain/consumables'
import { periodText, scheduleText } from '../domain/labels'
import type { Consumable, PlanWork } from '../domain/types'
import { useWorkStatuses } from '../plan/useWorkStatuses'
import { db } from '../storage/db'
import { useFertilizerLines } from './useFertilizerLines'
import { splitCardWorks } from './workGroups'

function whenText(work: PlanWork): string {
  if (work.recurrence === 'season' && work.seasonSchedule) return scheduleText(work.seasonSchedule)
  if (work.recurrence === 'once') return ['один раз', periodText(work.periods)].filter(Boolean).join(', ')
  return periodText(work.periods) || 'срок не указан'
}

/** Работы плана, в которых уже отмечена эта группа или этот объект. Правка — по ссылке в план. */
export function WorkLinks({ plantGroupId, objectId, returnPath }: { plantGroupId?: string; objectId?: string; returnPath: string }) {
  const works = useLiveQuery(() => db.planWorks.filter((work) => !work.deletedAt).toArray(), []) ?? []
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), []) ?? []
  const lines = useFertilizerLines(plantGroupId ? { plantGroupId } : undefined) ?? []
  const { list } = useWorkStatuses()
  const doneIds = new Set(list.filter((item) => item.status.state === 'done').map((item) => item.work.id))
  const matched = works
    .filter((work) => (plantGroupId ? work.plantGroupIds.includes(plantGroupId) : false) || (objectId ? work.objectIds.includes(objectId) : false))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const groups = splitCardWorks(matched, doneIds)

  const params = new URLSearchParams({ work: 'new', back: returnPath })
  if (plantGroupId) params.set('group', plantGroupId)
  if (objectId) params.set('object', objectId)

  return (
    <section className="care-links">
      <h3 className="section-title">Работы и материалы</h3>
      <p className="hint">Название, вид, описание и кратность берутся из карточки работы. Здесь их можно только посмотреть. Количество на 1 раз стоит после названия материала.</p>
      {matched.length === 0 && <p className="hint">Работ пока нет.</p>}
      <WorkGroup title="Запланированные" works={groups.planned} plantGroupId={plantGroupId} consumables={consumables} lines={lines} returnPath={returnPath} />
      <WorkGroup title="Выполненные" works={groups.done} plantGroupId={plantGroupId} consumables={consumables} lines={lines} returnPath={returnPath} />
      <WorkGroup title="В архиве плана" works={groups.archived} plantGroupId={plantGroupId} consumables={consumables} lines={lines} returnPath={returnPath} />
      <div className="actions">
        <a className="button" href={`#/works?${params.toString()}`}>
          Добавить работу
        </a>
      </div>
    </section>
  )
}

function WorkGroup({
  title,
  works,
  plantGroupId,
  consumables,
  lines,
  returnPath,
}: {
  title: string
  works: PlanWork[]
  plantGroupId?: string
  consumables: Consumable[]
  lines: FertilizerLine[]
  returnPath: string
}) {
  if (works.length === 0) return null
  return (
    <div>
      <h4 className="section-title">{title}</h4>
      {works.map((work) => {
        const linked = plantGroupId ? lines.filter((line) => line.workKind === work.workKind).map((line) => line.consumableId) : []
        const ids = [...new Set([...(work.consumableIds ?? []), ...linked])]
        return (
          <article key={work.id} className="care-link">
            <h3 className="section-title">{work.title}</h3>
            {work.workKind && <p className="small">Вид работы: {work.workKind}</p>}
            <p className="small muted">Кратность: {whenText(work)}</p>
            {work.note && <p className="small">{work.note}</p>}
            {ids.length > 0 && (
              <ul className="list">
                {ids.map((id) => {
                  const item = consumables.find((entry) => entry.id === id)
                  const rate = work.consumableRates?.[id]
                  const line = lines.find((entry) => entry.consumableId === id && entry.workKind === work.workKind)
                  const amount = rate
                    ? `${quantityText(rate.quantity, rate.unit || item?.unit || '')} на 1 раз`
                    : line?.perUse !== undefined
                      ? `${quantityText(line.perUse, line.measureUnit)} на 1 раз`
                      : ''
                  const name = item ? item.name : 'Материал удалён'
                  return <li key={id}>{amount ? `${name}, ${amount}` : name}</li>
                })}
              </ul>
            )}
            <p>
              <a className="source-link" href={`#/works?work=${work.id}&back=${encodeURIComponent(returnPath)}`}>
                Изменить в плане работ
              </a>
            </p>
          </article>
        )
      })}
    </div>
  )
}
