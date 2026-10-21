import { normalizeText } from '../domain/diaryFilter'
import type { CareObject, PlantGroup } from '../domain/types'
import { suggestParts } from './split'

export interface PartDraft {
  text: string
  type: 'work' | 'observation'
  objectId: string
  workKind?: string
  plantGroupIds: string[]
  /** Фото и файлы исходной записи прикрепляются к этой части. */
  withMedia: boolean
}

/** Группы, чьё название встречается в тексте части (по основе первого слова). */
function suggestGroups(text: string, groups: PlantGroup[]): string[] {
  const value = normalizeText(text)
  return groups.filter((group) => value.includes(normalizeText(group.name).split(/\s+/)[0].slice(0, 5))).map((group) => group.id)
}

export function makeParts(text: string, objects: CareObject[], groups: PlantGroup[], isWork?: boolean): PartDraft[] {
  const objectId = (name: string) => objects.find((item) => item.name === name)?.id ?? objects[0]?.id ?? ''
  return suggestParts(text, isWork).map((part, index) => ({
    text: part.text,
    type: part.type,
    objectId: objectId(part.objectName),
    workKind: part.workKind,
    plantGroupIds: suggestGroups(part.text, groups),
    withMedia: index === 0,
  }))
}
