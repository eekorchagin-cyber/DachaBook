import { useLiveQuery } from 'dexie-react-hooks'
import { UNITS } from '../domain/consumables'
import { sortAlphabet } from '../domain/dictionaries'
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
  /** Виды расходных материалов: удобрение, масло, бытовая химия. Без остатков и норм. */
  consumableKinds: string[]
  /** Условия проведения работ текстом. Заморозки считаются отдельно и сюда не входят. */
  workConditions: string[]
  /** Адрес и координаты участка: хранятся только на устройствах и в резервных копиях, не в коде. */
  plotAddress: string
  plotLocation: PlotLocation | null
  /** Фото дачи на главной: id файла из хранилища. Пусто — фото не выбрано. */
  plotPhotoId: string
  /** Плашка «Полив» на главной скрыта, пока сегодня раньше этой даты (ГГГГ-ММ-ДД). */
  wateringCardHiddenUntil: string
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
  consumableKinds: ['Удобрение', 'Средство защиты', 'Семена и посадочный материал', 'Горюче-смазочные', 'Бытовая химия'],
  workConditions: ['Как только просохнет почва после таяния снега'],
  plotAddress: '',
  plotLocation: null,
  plotPhotoId: '',
  wateringCardHiddenUntil: '',
}

let currentAuthor = ''

export const repo = new Repository(db, () => currentAuthor || 'Без имени')

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const row = await db.settings.get(key)
  return (row?.value as AppSettings[K] | undefined) ?? DEFAULT_SETTINGS[key]
}

const DICTIONARY_KEYS = ['workKinds', 'workKindRenames', 'consumableUnits', 'consumableKinds', 'workConditions'] as const

const SORTED_LISTS = ['workKinds', 'consumableUnits', 'consumableKinds', 'workConditions'] as const

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  const stored = (SORTED_LISTS as readonly string[]).includes(key) ? sortAlphabet(value as string[]) : value
  await db.settings.put({ key, value: stored })
  if (key === 'authorName') currentAuthor = value as string
  if ((DICTIONARY_KEYS as readonly string[]).includes(key)) {
    await db.settings.put({ key: 'dictionariesUpdatedAt', value: new Date().toISOString() })
  }
}

export function useSettings(): AppSettings | undefined {
  return useLiveQuery(async () => {
    const rows = await db.settings.toArray()
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<AppSettings>
    const settings = { ...DEFAULT_SETTINGS, ...values }
    settings.workKinds = sortAlphabet(settings.workKinds)
    settings.consumableUnits = sortAlphabet(settings.consumableUnits)
    settings.consumableKinds = sortAlphabet(settings.consumableKinds)
    settings.workConditions = sortAlphabet(settings.workConditions)
    currentAuthor = settings.authorName
    return settings
  })
}

/** Применяет тему и размер текста к документу. */
export function applyAppearance(settings: Pick<AppSettings, 'theme' | 'textScale'>): void {
  document.documentElement.dataset.theme = settings.theme
  document.documentElement.style.fontSize = `${Math.round(17 * settings.textScale)}px`
}
