import { useLiveQuery } from 'dexie-react-hooks'
import { UNITS } from '../domain/consumables'
import type { PlotLocation } from '../domain/location'
import { db } from '../storage/db'
import { Repository } from '../storage/repository'

export type ThemeSetting = 'system' | 'light' | 'dark'

export type PhotoPosition = 'right' | 'left' | 'below'

export interface AppSettings {
  authorName: string
  theme: ThemeSetting
  textScale: number
  /** Где показывать фото в карточках записей дневника. */
  photoPosition: PhotoPosition
  workKinds: string[]
  /** Прежние названия видов работ → новые: подсказки импорта знают о переименованиях. */
  workKindRenames: Record<string, string>
  consumableUnits: string[]
  /** Адрес и координаты участка: хранятся только на устройствах и в резервных копиях, не в коде. */
  plotAddress: string
  plotLocation: PlotLocation | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  authorName: '',
  theme: 'system',
  textScale: 1,
  photoPosition: 'right',
  workKinds: [
    'Стрижка газона',
    'Полив',
    'Подкормка',
    'Обработка от вредителей и болезней',
    'Обрезка',
    'Подвязка, укрытие и защита растений',
    'Посадка и посев',
    'Уборка листвы и мусора',
    'Сбор урожая',
    'Уборка снега',
    'Хозяйственные работы',
    'Прочее',
  ],
  workKindRenames: {},
  consumableUnits: UNITS,
  plotAddress: '',
  plotLocation: null,
}

let currentAuthor = ''

export const repo = new Repository(db, () => currentAuthor || 'Без имени')

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const row = await db.settings.get(key)
  return (row?.value as AppSettings[K] | undefined) ?? DEFAULT_SETTINGS[key]
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  await db.settings.put({ key, value })
  if (key === 'authorName') currentAuthor = value as string
}

export function useSettings(): AppSettings | undefined {
  return useLiveQuery(async () => {
    const rows = await db.settings.toArray()
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<AppSettings>
    const settings = { ...DEFAULT_SETTINGS, ...values }
    currentAuthor = settings.authorName
    return settings
  })
}

/** Применяет тему и размер текста к документу. */
export function applyAppearance(settings: Pick<AppSettings, 'theme' | 'textScale'>): void {
  document.documentElement.dataset.theme = settings.theme
  document.documentElement.style.fontSize = `${Math.round(17 * settings.textScale)}px`
}
