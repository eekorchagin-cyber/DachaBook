import type { CareObject, DocInput } from '../domain/types'
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
  if ((await db.settings.get('authorName'))?.value) await seedDefaultObjects()
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
