import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../storage/db'
import { Repository } from '../storage/repository'

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface AppSettings {
  authorName: string
  theme: ThemeSetting
  textScale: number
  workKinds: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  authorName: '',
  theme: 'system',
  textScale: 1,
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
