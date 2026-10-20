import type { CareObject, DocInput } from '../domain/types'
import { db } from '../storage/db'
import { repo } from './store'

const DEFAULT_OBJECTS: DocInput<CareObject>[] = [
  { name: 'Газон', type: 'lawn', active: true },
  { name: 'Сад', type: 'garden', active: true },
  { name: 'Грядки', type: 'beds', active: true },
  { name: 'Участок целиком', type: 'place', active: true },
  { name: 'Дом и хозяйство', type: 'place', active: true, description: 'Дом, баня, водопровод, септик, электричество' },
]

/** Первый запуск: стартовые объекты и просьба браузеру не стирать данные. */
export async function ensureSeeded(): Promise<void> {
  if (navigator.storage?.persist) void navigator.storage.persist()
  if (await db.settings.get('seeded')) return
  for (const object of DEFAULT_OBJECTS) await repo.create('objects', object)
  await db.settings.put({ key: 'seeded', value: new Date().toISOString() })
}
