import type { CareObject, DocInput, PlanWork, WateringZone } from '../domain/types'
import { folkSignKey, parseFolkSigns } from '../import/folkSigns'
import { stableId } from '../lib/hash'
import folkSignsMarkdown from '../seed/folk-signs.md?raw'
import { db, type DiaryDatabase } from '../storage/db'
import { Repository } from '../storage/repository'
import { repo } from './store'

const DEFAULT_OBJECTS: DocInput<CareObject>[] = [
  { name: 'Газон', type: 'lawn', active: true },
  { name: 'Сад', type: 'garden', active: true },
  { name: 'Грядки', type: 'beds', active: true },
  { name: 'Участок целиком', type: 'place', active: true },
  { name: 'Дом и хозяйство', type: 'place', active: true, description: 'Дом, баня, водопровод, септик, электричество' },
]

/** Запуск: просьба браузеру не стирать данные, встроенные приметы, стартовые объекты (если имя уже введено). */
export async function ensureSeeded(): Promise<void> {
  if (navigator.storage?.persist) void navigator.storage.persist()
  await seedFolkSigns(db)
  await seedPlanWorks(db)
  if ((await db.settings.get('authorName'))?.value) {
    await seedDefaultObjects()
    await seedWateringZones(db)
  }
}

/**
 * Стартовые объекты создаются после ввода имени, а не при открытии: на новом устройстве сначала можно
 * восстановить резервную копию, и тогда свои объекты уже есть — дубли не нужны.
 */
export async function seedDefaultObjects(): Promise<void> {
  if (await db.settings.get('seeded')) return
  if ((await db.objects.count()) === 0) for (const object of DEFAULT_OBJECTS) await repo.create('objects', object)
  await db.settings.put({ key: 'seeded', value: new Date().toISOString() })
}

/** Встроенный свод народных примет; идентификаторы одинаковы на всех устройствах, поэтому копии их не дублируют. */
export async function seedFolkSigns(database: DiaryDatabase): Promise<number> {
  if (await database.settings.get('folkSignsSeeded')) return 0
  const seeder = new Repository(database, () => 'DachaBook')
  let added = 0
  for (const sign of parseFolkSigns(folkSignsMarkdown)) {
    const id = await stableId(`folk-sign:${folkSignKey(sign)}`)
    if (await database.folkSigns.get(id)) continue
    await seeder.create('folkSigns', { ...sign, id })
    added++
  }
  await database.settings.put({ key: 'folkSignsSeeded', value: new Date().toISOString() })
  return added
}

/** Встроенные работы, привязанные к заморозкам; слова — для поиска таких работ в дневнике прошлых лет. */
const FROST_WORKS: (DocInput<PlanWork> & { key: string })[] = [
  {
    key: 'water-off',
    title: 'Слить и законсервировать дачный водопровод',
    workKind: 'Хозяйственные работы',
    note: 'Слить воду из труб, продуть, убрать насос — за неделю до первых заморозков.',
    objectIds: [],
    plantGroupIds: [],
    recurrence: 'yearly',
    periods: [],
    condition: { type: 'beforeAutumnFrost', leadDays: 7 },
    historyWords: [['водопровод'], ['слил', 'слить', 'продул', 'демонтир', 'отключил', 'законсерв', 'разобрал']],
    seasons: {},
    active: true,
  },
  {
    key: 'water-on',
    title: 'Смонтировать дачный водопровод',
    workKind: 'Хозяйственные работы',
    note: 'В ближайшую субботу после установления положительных температур: ночи без заморозков 3 дня и по прогнозу на неделю.',
    objectIds: [],
    plantGroupIds: [],
    recurrence: 'yearly',
    periods: [],
    condition: { type: 'afterSpringFrost', weekday: 6, calmDays: 3 },
    historyWords: [['водопровод'], ['смонтир', 'монтаж', 'монтир', 'запустил', 'подключил', 'собрал']],
    seasons: {},
    active: true,
  },
]

/** Одинаковые идентификаторы на всех устройствах: синхронизация и резервные копии не создают дублей. */
export async function seedPlanWorks(database: DiaryDatabase): Promise<number> {
  if (await database.settings.get('planWorksSeeded')) return 0
  const seeder = new Repository(database, () => 'DachaBook')
  let added = 0
  for (const { key, ...work } of FROST_WORKS) {
    const id = await stableId(`plan-work:${key}`)
    if (await database.planWorks.get(id)) continue
    await seeder.create('planWorks', { ...work, id })
    added++
  }
  await database.settings.put({ key: 'planWorksSeeded', value: new Date().toISOString() })
  return added
}

const WATERING_ZONES: (DocInput<WateringZone> & { key: string; objectName: string })[] = [
  {
    key: 'lawn',
    objectName: 'Газон',
    name: 'Газон',
    kind: 'sprinkler',
    objectIds: [],
    plantGroupIds: [],
    weekdays: [2, 5],
    durationMin: 20,
    timeFrom: '20:00',
    fromMonth: 5,
    fromDay: 15,
    toMonth: 9,
    toDay: 15,
    skipRainMm: 5,
    note: 'Дождевание. Если вчера и сегодня уже прошло 5 мм дождя — можно пропустить.',
    active: true,
  },
  {
    key: 'garden',
    objectName: 'Сад',
    name: 'Сад',
    kind: 'drip',
    objectIds: [],
    plantGroupIds: [],
    weekdays: [1, 4],
    durationMin: 40,
    timeFrom: '21:00',
    fromMonth: 5,
    fromDay: 1,
    toMonth: 9,
    toDay: 20,
    skipRainMm: 8,
    note: 'Капельный полив деревьев и кустов.',
    active: true,
  },
  {
    key: 'beds',
    objectName: 'Грядки',
    name: 'Грядки',
    kind: 'drip',
    objectIds: [],
    plantGroupIds: [],
    weekdays: [1, 3, 5],
    durationMin: 25,
    timeFrom: '19:30',
    fromMonth: 5,
    fromDay: 10,
    toMonth: 9,
    toDay: 10,
    skipRainMm: 4,
    note: 'Капля или шланг по грядкам.',
    active: true,
  },
]

/** Стартовые зоны полива привязываются к объектам Газон / Сад / Грядки, если они есть. */
export async function seedWateringZones(database: DiaryDatabase): Promise<number> {
  if (await database.settings.get('wateringZonesSeeded')) return 0
  const seeder = new Repository(database, () => 'DachaBook')
  const objects = await database.objects.toArray()
  let added = 0
  for (const { key, objectName, ...zone } of WATERING_ZONES) {
    const id = await stableId(`watering-zone:${key}`)
    if (await database.wateringZones.get(id)) continue
    const object = objects.find((item) => !item.deletedAt && item.name === objectName)
    await seeder.create('wateringZones', { ...zone, id, objectIds: object ? [object.id] : [] })
    added++
  }
  await database.settings.put({ key: 'wateringZonesSeeded', value: new Date().toISOString() })
  return added
}
