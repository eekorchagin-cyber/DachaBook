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

/** Объединение списков при восстановлении копии: свой порядок сохраняется, новые пункты добавляются в конец. */
export function mergeItems(current: string[], incoming: string[]): string[] {
  return [...current, ...incoming.filter((item) => !current.some((existing) => same(existing, item)))]
}
