import { DEFAULT_SETTINGS } from '../app/store'
import { mergeDictionaries, sameDictionaries, type DictionarySnapshot } from '../domain/dictionaries'
import type { DiaryDatabase } from '../storage/db'
import type { CloudAdapter } from './cloud'

export const DICTIONARIES_PATH = 'settings/dictionaries.json'

async function readLocal(database: DiaryDatabase): Promise<DictionarySnapshot> {
  const value = async <T>(key: string, fallback: T): Promise<T> => ((await database.settings.get(key))?.value as T | undefined) ?? fallback
  return {
    updatedAt: await value('dictionariesUpdatedAt', ''),
    workKinds: await value('workKinds', DEFAULT_SETTINGS.workKinds),
    workKindRenames: await value('workKindRenames', {}),
    consumableUnits: await value('consumableUnits', DEFAULT_SETTINGS.consumableUnits),
    consumableKinds: await value('consumableKinds', DEFAULT_SETTINGS.consumableKinds),
    workConditions: await value('workConditions', DEFAULT_SETTINGS.workConditions),
  }
}

async function writeLocal(database: DiaryDatabase, file: DictionarySnapshot): Promise<void> {
  await database.settings.bulkPut([
    { key: 'workKinds', value: file.workKinds },
    { key: 'workKindRenames', value: file.workKindRenames },
    { key: 'consumableUnits', value: file.consumableUnits },
    { key: 'consumableKinds', value: file.consumableKinds },
    { key: 'workConditions', value: file.workConditions },
    { key: 'dictionariesUpdatedAt', value: file.updatedAt },
    { key: 'dictionariesPulledAt', value: file.updatedAt },
  ])
}

/** Обмен справочниками через облако. Настройки участка сюда не входят: их затирание с другого устройства опаснее. */
export async function syncDictionaries(database: DiaryDatabase, cloud: CloudAdapter, now = new Date()): Promise<void> {
  await cloud.ensureFolder('settings')
  const local = await readLocal(database)
  const blob = await cloud.read(DICTIONARIES_PATH)
  const remote = blob ? (JSON.parse(await blob.text()) as DictionarySnapshot) : null
  const merged = mergeDictionaries(local, remote)
  const changed = !remote || !sameDictionaries(merged, remote) || !sameDictionaries(merged, local)
  const file = changed ? { ...merged, updatedAt: now.toISOString() } : merged
  if (!sameDictionaries(file, local) || file.updatedAt !== local.updatedAt) await writeLocal(database, file)
  else await database.settings.put({ key: 'dictionariesPulledAt', value: file.updatedAt })
  if (!remote || !sameDictionaries(file, remote) || file.updatedAt !== remote.updatedAt) {
    await cloud.write(DICTIONARIES_PATH, new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  }
}
