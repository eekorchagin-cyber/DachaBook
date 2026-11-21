import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../app/store'
import { SHOPPING_STATUS, shoppingQuantityText } from '../domain/shopping'
import type { ShoppingDraft } from '../domain/shopping'
import { buyPackages, packagesFromStore, purchasePlan, rateAreas } from '../domain/purchases'
import { workTimes } from '../domain/applications'
import { todayAtSite } from '../domain/dates'
import { addToShoppingList } from '../plan/shoppingActions'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { errorText } from '../lib/format'
import { useState } from 'react'

/** Рассчитанные покупки по всем работам плана — без уже купленных дублей. */
async function draftsFromPlan(): Promise<ShoppingDraft[]> {
  const [works, consumables, objects, groups] = await Promise.all([
    db.planWorks.filter((work) => !work.deletedAt && work.active).toArray(),
    db.consumables.filter((item) => !item.deletedAt).toArray(),
    db.objects.toArray(),
    db.plantGroups.toArray(),
  ])
  const today = todayAtSite().date
  const byId = new Map(consumables.map((item) => [item.id, item]))
  const drafts = new Map<string, ShoppingDraft>()
  for (const work of works) {
    const times = workTimes(work, today)
    const rated = rateAreas(
      groups.filter((group) => work.plantGroupIds.includes(group.id)).map((group) => ({ name: group.name, areaM2: group.areaM2 })),
      objects.filter((object) => work.objectIds.includes(object.id)).map((object) => ({ name: object.name, areaM2: object.areaM2 })),
    )
    for (const id of work.consumableIds ?? []) {
      const item = byId.get(id)
      if (!item) continue
      const plan = purchasePlan({
        unit: item.unit,
        ratePerM2: item.ratePerM2,
        rateUnit: item.rateUnit,
        applications: times,
        packQuantity: item.packQuantity,
        packUnit: item.packUnit,
        areas: rated.areas,
        areaKind: rated.areaKind,
        usedThisYear: 0,
        pastUsage: [],
      })
      const packs = item.packQuantity ? plan.unitsNeed : undefined
      const buy = buyPackages(packs, packagesFromStore(item.stockQuantity, item))
      if (!(buy && buy > 0)) continue
      const previous = drafts.get(id)
      drafts.set(id, {
        consumableId: id,
        name: item.name,
        quantity: previous ? Math.max(previous.quantity, buy) : buy,
        unit: 'уп.',
        workId: work.id,
      })
    }
  }
  return [...drafts.values()]
}

export function ShoppingScreen() {
  const items = useLiveQuery(() => db.shoppingItems.filter((item) => !item.deletedAt).toArray(), [])
  const [error, setError] = useState('')
  const list = [...(items ?? [])].sort((a, b) => Number(a.status === 'bought') - Number(b.status === 'bought') || a.name.localeCompare(b.name, 'ru'))
  const open = list.filter((item) => item.status === 'toBuy')
  const bought = list.filter((item) => item.status === 'bought')

  return (
    <Screen title="Возьми" help="shopping" back="/more/works" tab="/more">
      <p className="hint">Рассчитанные покупки из плана. Один материал — одна строка. Статус «к покупке» снимается, когда отметили «Куплено».</p>
      <div className="actions">
        <ActionButton
          onRun={async () => {
            setError('')
            try {
              const drafts = await draftsFromPlan()
              if (drafts.length === 0) {
                alert('Сейчас в плане нет покупок с заполненным запасом и количеством упаковок.')
                return
              }
              const result = await addToShoppingList(drafts)
              alert(
                result.added + result.updated > 0
                  ? `Добавлено ${result.added}, обновлено ${result.updated}.`
                  : 'Все рассчитанные покупки уже в списке.',
              )
            } catch (caught) {
              setError(errorText(caught))
            }
          }}
        >
          Добавить рассчитанные
        </ActionButton>
      </div>
      {error && <p className="error">{error}</p>}
      {items && list.length === 0 && <EmptyState>Список пуст. В карточке работы нажмите «В «Возьми»» или добавьте рассчитанные здесь.</EmptyState>}
      {open.length > 0 && (
        <section>
          <h2 className="section-title">К покупке</h2>
          <ul className="list">
            {open.map((item) => (
              <li key={item.id} className="list-row">
                <span>
                  <strong>{item.name}</strong>{' '}
                  <span className="muted">
                    {shoppingQuantityText(item)} · {SHOPPING_STATUS[item.status]}
                  </span>
                </span>
                <span className="actions">
                  <ActionButton
                    onRun={async () => {
                      await repo.update('shoppingItems', item.id, { status: 'bought' }, item.revision)
                    }}
                  >
                    Куплено
                  </ActionButton>
                  <ActionButton
                    secondary
                    onRun={async () => {
                      if (!confirm(`Убрать «${item.name}» из списка?`)) return
                      await repo.remove('shoppingItems', item.id, item.revision)
                    }}
                  >
                    Убрать
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {bought.length > 0 && (
        <section>
          <h2 className="section-title">Куплено</h2>
          <ul className="list">
            {bought.map((item) => (
              <li key={item.id} className="list-row">
                <span>
                  <strong>{item.name}</strong>{' '}
                  <span className="muted">
                    {shoppingQuantityText(item)} · {SHOPPING_STATUS[item.status]}
                  </span>
                </span>
                <span className="actions">
                  <ActionButton
                    secondary
                    onRun={async () => {
                      await repo.update('shoppingItems', item.id, { status: 'toBuy' }, item.revision)
                    }}
                  >
                    Снова к покупке
                  </ActionButton>
                  <ActionButton
                    secondary
                    onRun={async () => {
                      if (!confirm(`Убрать «${item.name}» из списка?`)) return
                      await repo.remove('shoppingItems', item.id, item.revision)
                    }}
                  >
                    Убрать
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
