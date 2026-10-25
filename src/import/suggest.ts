import { normalizeText } from '../domain/diaryFilter'
import { resolveRename } from '../domain/dictionaries'

/** Подсказки по ключевым словам; окончательно тип, место и вид работы подтверждает пользователь (раздел 3 ТЗ). */

const OBJECT_RULES: { name: string; words: RegExp }[] = [
  {
    name: 'Дом и хозяйство',
    words: /(бан[яеиюь]|септик|водопровод|канализ|колод|генератор|счетчик|туалет|бойлер|насос|печк|окна|водосток|дров|продух|продых|контейнер|газонокосилк|дорожк|половик|керхер|электр|ремонт|встреч)/,
  },
  { name: 'Газон', words: /(газон|одуванч|вертикуляц|аэрац)/ },
  {
    name: 'Грядки',
    words: /(гряд|редис|огур|помидор|томат|перц|кабач|патиссон|тыкв|лук|чеснок|зелен|горох|свекл|шпинат|салат|укроп|петрушк|рассад|клубник|парник|настурци)/,
  },
  {
    name: 'Сад',
    words: /((^| )сад|яблон|смородин|крыжовник|малин|вишн|жимолост|калин|хост|астильб|гортенз|пион|сирен|спире|пузыреплод|дерен|можжевел|сосн|(^| )(елк|елок|ель|ели|елей)|(^| )ту[иья]|хвойн|(^| )дуб|берез|кустарн|колеус|бегони|деревь|плодов|листв|листь)/,
  },
]

const WORK_KIND_RULES: { kind: string; words: RegExp }[] = [
  { kind: 'Уборка снега', words: /снег/ },
  { kind: 'Стрижка газона', words: /(стрижк|скосил|подстриг|косил)/ },
  { kind: 'Обработка от вредителей и болезней', words: /(обработ|актар|обрызг|опрыск|фуфанон|фитоспорин|клещ|иксодер|таран|муравьед|бордоск)/ },
  { kind: 'Подкормка', words: /(подкорм|удобр|фертик|мочевин|селитр|суперфосфат|перегно|циркон|известь|раскислен)/ },
  { kind: 'Полив', words: /(полив|пролил|пролили|пролить)/ },
  { kind: 'Обрезка', words: /(обрез|обрезк|формирован)/ },
  { kind: 'Подвязка, укрытие и защита растений', words: /(обвяз|подвяз|укрыл|укрыли|укрыть|укрывн|защитн)/ },
  { kind: 'Подвязка, укрытие и защита растений', words: /(обвяз|подвяз|укрыл|укрыли|укрыть|укрывн|защитн)/ },
  { kind: 'Посадка и посев', words: /(посад|посея|посев|высад|засеял)/ },
  { kind: 'Сбор урожая', words: /(урожа|собрали|сняли)/ },
  { kind: 'Уборка листвы и мусора', words: /(листв|листь|мусор|перемол|дробилк)/ },
  { kind: 'Хозяйственные работы', words: /(бан[яеиюь]|септик|водопровод|канализ|генератор|бойлер|насос|печк|окна|водосток|продух|ремонт|смонтировал)/ },
]

/** Глаголы действия: строка без флажка с таким глаголом, вероятно, описывает работу, а не наблюдение. */
const WORK_VERBS =
  /(^|\s)(обрезал|обрезали|удобрил|удобрили|обрызгал|обрызгали|опрыскал|посадил|посадили|высадили|посеял|засеял|скосил|скосили|подстриг|подстригли|подкормил|подкормили|пролил|пролили|обработал|обработали|убрал|убрали|собрали|сняли|смонтировал|отключил|включил|запустил|подключил|установил|откачал|откачали|слил|продул|вымыл|вымыли|отмыл|отмыли|перебрал|заложили|закрыл|утеплили|провел|очистили|навели|прочесал|вычесал|покрасил|купить|привезти|обвязал|пропололи|подвязали|демонтаж)(\s|$|[,.!:;])/

export function suggestObject(text: string): string {
  const value = normalizeText(text)
  return OBJECT_RULES.find((rule) => rule.words.test(value))?.name ?? 'Участок целиком'
}

let workKinds: { list?: string[]; renames: Record<string, string> } = { renames: {} }

/** Виды работ из настроек: подсказка учитывает переименования и не предлагает удалённые виды. */
export function setWorkKinds(list: string[], renames: Record<string, string>): void {
  workKinds = { list, renames }
}

export function suggestWorkKind(text: string): string | undefined {
  const value = normalizeText(text)
  const kind = WORK_KIND_RULES.find((rule) => rule.words.test(value))?.kind
  if (!kind) return undefined
  const current = resolveRename(workKinds.renames, kind)
  return !workKinds.list || workKinds.list.includes(current) ? current : undefined
}

export function looksLikeWork(text: string): boolean {
  return WORK_VERBS.test(normalizeText(text))
}

/** Ключ сравнения текста: без регистра, «ё», пунктуации и лишних пробелов. */
export function textKey(text: string): string {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function bigramOverlap(a: string, b: string): { overlap: number; x: number; y: number } {
  const x = textKey(a)
  const y = textKey(b)
  const bigrams = new Map<string, number>()
  for (let i = 0; i < x.length - 1; i++) {
    const pair = x.slice(i, i + 2)
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1)
  }
  let overlap = 0
  for (let i = 0; i < y.length - 1; i++) {
    const pair = y.slice(i, i + 2)
    const count = bigrams.get(pair) ?? 0
    if (count > 0) {
      bigrams.set(pair, count - 1)
      overlap++
    }
  }
  return { overlap, x: Math.max(0, x.length - 1), y: Math.max(0, y.length - 1) }
}

/** Сходство двух текстов по биграммам (коэффициент Дайса), от 0 до 1. */
export function similarity(a: string, b: string): number {
  if (textKey(a) === textKey(b)) return 1
  const { overlap, x, y } = bigramOverlap(a, b)
  return x + y === 0 ? 0 : (2 * overlap) / (x + y)
}

/**
 * Похож ли текст на правку другого: короткий почти целиком входит в длинный (дописали фразу, исправили опечатку),
 * а длины сопоставимы — короткая строка не «находится» случайно внутри длинной статьи.
 */
export function isEditOf(a: string, b: string): boolean {
  const { overlap, x, y } = bigramOverlap(a, b)
  const shorter = Math.min(x, y)
  const longer = Math.max(x, y)
  return shorter >= 8 && overlap / shorter >= 0.85 && shorter / longer >= 0.4
}
