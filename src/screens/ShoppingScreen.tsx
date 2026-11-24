import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../app/store'
import { SHOPPING_STATUS, shoppingPackText, shoppingQuantityText, shoppingVoimiText } from '../domain/shopping'
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

/** Скопировать текст в буфер; если нельзя — скачать .txt для вставки в «Возьми». */
async function copyOrDownloadVoimi(text: string, fileName: string): Promise<'copied' | 'downloaded'> {
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    /* запасной путь ниже */
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

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
  const consumables = useLiveQuery(() => db.consumables.filter((item) => !item.deletedAt).toArray(), [])
  const [error, setError] = useState('')
  const list = [...(items ?? [])].sort((a, b) => Number(a.status === 'bought') - Number(b.status === 'bought') || a.name.localeCompare(b.name, 'ru'))
  const open = list.filter((item) => item.status === 'toBuy')
  const bought = list.filter((item) => item.status === 'bought')
  const consumableById = new Map((consumables ?? []).map((item) => [item.id, item]))
  const packLine = (item: { consumableId: string; quantity: number; unit: string }) => {
    const material = consumableById.get(item.consumableId)
    return shoppingPackText({
      quantity: item.quantity,
      unit: item.unit,
      packQuantity: material?.packQuantity,
      packUnit: material?.packUnit,
    })
  }

  return (
    <Screen title="Список покупок" help="shopping" back="/more" tab="/more">
      <p className="hint">
        Рассчитанные покупки из плана. Один материал — одна строка. Нажмите название в «К покупке», чтобы перенести в «Куплено».
        Если в справочнике задана фасовка, под количеством видно размер упаковки. «В „Возьми“» копирует позиции «к покупке» текстом
        для импорта в семейный список.
      </p>
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
        <ActionButton
          secondary
          disabled={open.length === 0}
          onRun={async () => {
            setError('')
            const lines = open.map((item) => {
              const material = consumableById.get(item.consumableId)
              return {
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                packQuantity: material?.packQuantity,
                packUnit: material?.packUnit,
              }
            })
            const text = shoppingVoimiText(lines)
            if (!text.trim()) {
              alert('В «К покупке» сейчас пусто.')
              return
            }
            try {
              const stamp = todayAtSite().date.replaceAll('-', '')
              const how = await copyOrDownloadVoimi(text, `dachabook-voimi-${stamp}.txt`)
              alert(
                how === 'copied'
                  ? `Скопировано ${open.length} поз. Откройте «Возьми» → вставить список из буфера.`
                  : `Сохранён файл со списком (${open.length} поз.). В «Возьми» импортируйте его из файла.`,
              )
            } catch (caught) {
              setError(errorText(caught))
            }
          }}
        >
          В «Возьми»
        </ActionButton>
      </div>
      {error && <p className="error">{error}</p>}
      {items && list.length === 0 && <EmptyState>Список пуст. В карточке работы нажмите «В «Купить»» или добавьте рассчитанные здесь.</EmptyState>}
      {open.length > 0 && (
        <section>
          <h2 className="section-title">К покупке</h2>
          <ul className="list">
            {open.map((item) => {
              const pack = packLine(item)
              return (
                <li key={item.id} className="list-row">
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => void repo.update('shoppingItems', item.id, { status: 'bought' }, item.revision)}
                  >
                    {item.name}
                    <span className="muted">
                      {' '}
                      {pack ?? shoppingQuantityText(item)} · {SHOPPING_STATUS[item.status]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {bought.length > 0 && (
        <section>
          <h2 className="section-title">Куплено</h2>
          <ul className="list">
            {bought.map((item) => {
              const pack = packLine(item)
              return (
                <li key={item.id} className="list-row">
                  <span>
                    <strong>{item.name}</strong>{' '}
                    <span className="muted">
                      {pack ?? shoppingQuantityText(item)} · {SHOPPING_STATUS[item.status]}
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
              )
            })}
          </ul>
        </section>
      )}
    </Screen>
  )
}
