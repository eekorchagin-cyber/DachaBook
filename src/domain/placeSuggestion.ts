/** Куда положить новый материал, чтобы он оказался рядом с похожими. */

export interface StoredThing {
  id?: string
  name: string
  kind?: string
  place?: string
  deletedAt?: string
}

export interface StorageSuggestion {
  /** Место, где уже лежат похожие материалы. */
  place?: string
  /** Названия этих материалов, самые близкие первыми. */
  neighbors: string[]
  /** Вид из справочника, если у нового материала вид ещё не выбран. */
  kind?: string
}

const KIND_NEEDLES: { kind: string; needles: string[] }[] = [
  { kind: 'Удобрение', needles: ['удобр', 'азоф', 'фертик', 'селитр', 'мочевин', 'суперфосф', 'гумат', 'компост', 'перегн', 'калий'] },
  { kind: 'Средство защиты', needles: ['актар', 'фитоспор', 'фуфанон', 'бордос', 'гербицид', 'инсектиц', 'фунгицид'] },
  { kind: 'Семена и посадочный материал', needles: ['семен', 'семян', 'сажен', 'луковиц', 'рассад'] },
  { kind: 'Горюче-смазочные', needles: ['масло', 'бензин', 'смазк', 'соляр'] },
  { kind: 'Бытовая химия', needles: ['уксус', 'отбел', 'порош', 'моющ'] },
]

function fold(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

function words(value: string): string[] {
  return fold(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3)
}

/** «коры» и «кора», «масла» и «масло» — один корень. */
function stem(word: string): string {
  const cut = word.replace(/[аеиоуыэюя]+$/u, '')
  return cut.length >= 3 ? cut : word
}

function sameStem(a: string, b: string): boolean {
  const left = stem(a)
  const right = stem(b)
  return left.length >= 3 && left === right
}

function sharedWords(a: string, b: string): number {
  const right = words(b)
  const used = new Set<number>()
  let count = 0
  for (const left of words(a)) {
    const index = right.findIndex((word, position) => !used.has(position) && sameStem(left, word))
    if (index >= 0) {
      used.add(index)
      count++
    }
  }
  return count
}

export function inferKind(name: string, kinds: string[]): string | undefined {
  const folded = fold(name)
  const hit = KIND_NEEDLES.find((item) => item.needles.some((needle) => folded.includes(fold(needle))))
  if (!hit) return undefined
  return kinds.find((kind) => fold(kind) === fold(hit.kind))
}

interface Scored {
  name: string
  place: string
  kind?: string
  nameScore: number
  score: number
}

/**
 * Предложение для нового материала.
 * Совпадение по названию важнее вида. Если названия не похожи, берётся место, где уже лежит большинство материалов того же вида.
 * Два разных места с одинаковым весом не предлагаются: выбор остаётся за человеком.
 */
export function suggestStorage(
  name: string,
  items: StoredThing[],
  options?: { kind?: string; kinds?: string[]; exceptId?: string },
): StorageSuggestion | undefined {
  const trimmed = name.trim()
  if (trimmed.length < 3) return undefined
  const kinds = options?.kinds ?? []
  const chosen = options?.kind?.trim()
  const inferred = inferKind(trimmed, kinds.length > 0 ? kinds : KIND_NEEDLES.map((item) => item.kind))
  const effective = chosen || inferred
  const scored: Scored[] = []
  for (const item of items) {
    if (item.deletedAt || !item.place?.trim()) continue
    if (options?.exceptId && item.id === options.exceptId) continue
    if (fold(item.name) === fold(trimmed)) continue
    const shared = sharedWords(trimmed, item.name)
    const nameScore = shared > 0 ? Math.min(1, 0.55 + 0.15 * (shared - 1)) : 0
    const sameKind = !!effective && !!item.kind && fold(item.kind) === fold(effective)
    const score = nameScore > 0 ? nameScore : sameKind ? 0.45 : 0
    if (score < 0.45) continue
    scored.push({ name: item.name, place: item.place.trim(), kind: item.kind, nameScore, score })
  }

  const buckets = new Map<string, { place: string; score: number; best: number; neighbors: { name: string; score: number }[] }>()
  for (const item of scored) {
    const key = fold(item.place)
    const bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, { place: item.place, score: item.score, best: item.score, neighbors: [{ name: item.name, score: item.score }] })
      continue
    }
    bucket.score += item.score
    bucket.neighbors.push({ name: item.name, score: item.score })
    if (item.score > bucket.best) {
      bucket.best = item.score
      bucket.place = item.place
    }
  }
  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score || a.place.localeCompare(b.place, 'ru'))
  const best = ranked[0]
  const second = ranked[1]
  const place = best && best.score >= 0.45 && (!second || best.score > second.score + 0.05) ? best.place : undefined
  const neighbors = (best && place ? best.neighbors : [])
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .map((item) => item.name)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 3)

  const votes = new Map<string, number>()
  for (const item of scored) {
    if (!item.kind || item.nameScore < 0.5) continue
    votes.set(item.kind, (votes.get(item.kind) ?? 0) + item.nameScore)
  }
  let voted: { kind: string; score: number } | undefined
  for (const [kind, score] of votes) if (!voted || score > voted.score) voted = { kind, score }
  const fromNeighbors = voted && voted.score >= 0.5 ? kinds.find((kind) => fold(kind) === fold(voted.kind)) : undefined
  const kind = chosen ? undefined : inferred || fromNeighbors
  if (!place && !kind) return undefined
  return { place, neighbors, kind }
}

/** Список материалов по местам: занятые места по алфавиту, без места — в конце. Внутри места — по названию. */
export function groupByPlace<T extends { name: string; place?: string }>(items: T[]): { place: string; items: T[] }[] {
  const groups = new Map<string, { place: string; items: T[] }>()
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
    const place = item.place?.trim() ?? ''
    const key = fold(place)
    const current = groups.get(key)
    if (current) current.items.push(item)
    else groups.set(key, { place, items: [item] })
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.place) return 1
    if (!b.place) return -1
    return a.place.localeCompare(b.place, 'ru')
  })
}
