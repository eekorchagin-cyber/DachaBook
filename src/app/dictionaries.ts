import { addRename } from '../domain/dictionaries'
import { db } from '../storage/db'
import { getSetting, repo, setSetting } from './store'

/** Переименование вида работ меняет его и во всех записях дневника (с новой ревизией у каждой). */
export async function renameWorkKind(from: string, to: string): Promise<boolean> {
  const events = await db.events.where('workKind').equals(from).toArray()
  if (events.length > 0 && !confirm(`Переименовать «${from}» в «${to}»? Вид работы изменится и в записях дневника: ${events.length}.`)) return false
  for (const event of events) await repo.update('events', event.id, { workKind: to }, event.revision)
  await setSetting('workKinds', (await getSetting('workKinds')).map((kind) => (kind === from ? to : kind)))
  await setSetting('workKindRenames', addRename(await getSetting('workKindRenames'), from, to))
  return true
}

/** Удалённый вид работ остаётся в старых записях, но больше не предлагается. */
export async function removeWorkKind(kind: string): Promise<boolean> {
  const used = await db.events.where('workKind').equals(kind).count()
  const message = used > 0 ? `Убрать «${kind}» из списка? В ${used} записях дневника вид работы останется, но для новых записей его не будет.` : `Убрать «${kind}» из списка?`
  if (!confirm(message)) return false
  await setSetting('workKinds', (await getSetting('workKinds')).filter((item) => item !== kind))
  return true
}

/** Переименование единицы меняет её у расходных материалов; количества в записях не пересчитываются. */
export async function renameUnit(from: string, to: string): Promise<boolean> {
  const consumables = (await db.consumables.toArray()).filter((item) => item.unit === from)
  if (consumables.length > 0 && !confirm(`Переименовать «${from}» в «${to}»? Единица изменится у материалов: ${consumables.length}. Количества не пересчитываются.`)) return false
  for (const item of consumables) await repo.update('consumables', item.id, { unit: to }, item.revision)
  await setSetting('consumableUnits', (await getSetting('consumableUnits')).map((unit) => (unit === from ? to : unit)))
  return true
}

export async function removeUnit(unit: string): Promise<boolean> {
  const used = (await db.consumables.toArray()).filter((item) => item.unit === unit && !item.deletedAt).length
  const message = used > 0 ? `Убрать «${unit}» из списка? У ${used} материалов единица останется, но в подсказках её не будет.` : `Убрать «${unit}» из списка?`
  if (!confirm(message)) return false
  await setSetting('consumableUnits', (await getSetting('consumableUnits')).filter((item) => item !== unit))
  return true
}
