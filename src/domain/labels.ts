import type { DiaryEvent, EventType, ObjectType } from './types'

export const OBJECT_TYPES: Record<ObjectType, string> = {
  lawn: 'Газон',
  garden: 'Сад',
  beds: 'Грядки',
  plants: 'Группа посадок',
  place: 'Место',
}

export const EVENT_TYPES: Record<EventType, { label: string; icon: string }> = {
  work: { label: 'Работа', icon: '⚒' },
  observation: { label: 'Наблюдение', icon: '👁' },
  measurement: { label: 'Измерение', icon: '🌡' },
}

export function measurementText(event: DiaryEvent): string {
  const parts: string[] = []
  if (event.measurement?.temperature) parts.push(`почва ${event.measurement.temperature.value} °C`)
  if (event.measurement?.moisture) parts.push(`влажность ${event.measurement.moisture.value} (${event.measurement.moisture.scale})`)
  return parts.join(', ')
}
