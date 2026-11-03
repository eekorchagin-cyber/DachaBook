/** Пункты справочников: виды работ, единицы расходных материалов. */

export function cleanItem(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const same = (a: string, b: string) => cleanItem(a).toLowerCase().replace(/ё/g, 'е') === cleanItem(b).toLowerCase().replace(/ё/g, 'е')

/** Почему значение нельзя сохранить (пусто или уже есть); except — пункт, который сейчас переименовывается. */
export function itemProblem(items: string[], value: string, except?: string): string | null {
  if (!cleanItem(value)) return 'Введите название'
  if (items.some((item) => item !== except && same(item, value))) return 'Такой пункт уже есть'
  return null
}

export function moveItem(items: string[], index: number, delta: number): string[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Запоминает переименование: старые названия (и всё, что раньше вело к ним) ведут к новому. */
export function addRename(renames: Record<string, string>, from: string, to: string): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(renames)) next[key] = value === from ? to : value
  next[from] = to
  for (const [key, value] of Object.entries(next)) if (key === value) delete next[key]
  return next
}

export function resolveRename(renames: Record<string, string>, name: string): string {
  let current = name
  for (let step = 0; step < 20 && renames[current]; step++) current = renames[current]
  return current
}

/** Алфавит справочника: без учёта регистра, «ё» рядом с «е». */
export function byAlphabet(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { sensitivity: 'base' })
}

export function sortAlphabet(items: string[]): string[] {
  return [...items].sort(byAlphabet)
}

/** Объединение списков при восстановлении копии: свой порядок сохраняется, новые пункты добавляются в конец. */
export function mergeItems(current: string[], incoming: string[]): string[] {
  return [...current, ...incoming.filter((item) => !current.some((existing) => same(existing, item)))]
}

/** Справочники, общие для телефона и планшета. Пустой список не затирает заполненный. */
export interface DictionarySnapshot {
  updatedAt: string
  workKinds: string[]
  workKindRenames: Record<string, string>
  consumableUnits: string[]
  consumableKinds: string[]
  workConditions: string[]
}

function unionLists(current: string[], incoming: string[]): string[] {
  if (current.length === 0) return [...incoming]
  if (incoming.length === 0) return [...current]
  return mergeItems(current, incoming)
}

function applyRenames(names: string[], renames: Record<string, string>): string[] {
  const next: string[] = []
  for (const name of names) {
    const resolved = resolveRename(renames, name)
    if (!next.some((item) => same(item, resolved))) next.push(resolved)
  }
  return next
}

/** Сливает справочники двух устройств: переименование «Подкормка» → «Внесение удобрений» применяется и к старому списку. */
export function mergeDictionaries(local: DictionarySnapshot, remote: DictionarySnapshot | null): DictionarySnapshot {
  if (!remote) {
    return {
      ...local,
      workKinds: sortAlphabet(local.workKinds),
      consumableUnits: sortAlphabet(local.consumableUnits),
      consumableKinds: sortAlphabet(local.consumableKinds),
      workConditions: sortAlphabet(local.workConditions),
    }
  }
  const localNewer = local.updatedAt >= remote.updatedAt
  const renames = localNewer ? { ...remote.workKindRenames, ...local.workKindRenames } : { ...local.workKindRenames, ...remote.workKindRenames }
  return {
    updatedAt: local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt,
    workKinds: sortAlphabet(applyRenames(unionLists(local.workKinds, remote.workKinds), renames)),
    workKindRenames: renames,
    consumableUnits: sortAlphabet(unionLists(local.consumableUnits, remote.consumableUnits)),
    consumableKinds: sortAlphabet(unionLists(local.consumableKinds, remote.consumableKinds)),
    workConditions: sortAlphabet(unionLists(local.workConditions, remote.workConditions)),
  }
}

export function sameDictionaries(a: DictionarySnapshot, b: DictionarySnapshot): boolean {
  const list = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index])
  return (
    list(a.workKinds, b.workKinds) &&
    list(a.consumableUnits, b.consumableUnits) &&
    list(a.consumableKinds, b.consumableKinds) &&
    list(a.workConditions, b.workConditions) &&
    JSON.stringify(a.workKindRenames) === JSON.stringify(b.workKindRenames)
  )
}
