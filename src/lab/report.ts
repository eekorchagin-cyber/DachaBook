import { formatBytes } from '../lib/format'
import { readEnvironment } from './environment'
import type { LabResult } from './results'

const TITLES: Record<string, string> = {
  env: 'Устройство',
  'storage-docs': 'Хранилище: записи',
  'storage-blob-5': 'Хранилище: файл 5 МБ',
  'storage-blob-50': 'Хранилище: файл 50 МБ',
  marker: 'Сохранность через неделю',
  sw: 'Офлайн-режим',
  offline: 'Запуск без сети',
  photos: 'Фотографии',
  'yandex-auth': 'Вход в Яндекс',
  yandex: 'Яндекс Диск',
  enex: 'Разбор ENEX',
}

const STATUS: Record<LabResult['status'], string> = { ok: 'ОК', warn: 'ЗАМЕЧАНИЯ', fail: 'СБОЙ', info: 'СВЕДЕНИЯ' }

export async function buildReport(results: Record<string, LabResult>): Promise<string> {
  const env = await readEnvironment()
  const lines = [
    `DachaBook, отчёт этапа 1 — ${new Date().toLocaleString('ru-RU')}`,
    `Версия: ${env.version}`,
    `Браузер: ${env.userAgent}`,
    `Открыто: ${env.standalone ? 'с экрана «Домой»' : 'во вкладке'}; экран ${env.screen}`,
    `Хранилище: ${formatBytes(env.storageUsage ?? 0)} из ${formatBytes(env.storageQuota ?? 0)}; постоянное: ${env.persisted ? 'да' : 'нет'}`,
    '',
  ]
  for (const [id, title] of Object.entries(TITLES)) {
    const result = results[id]
    if (!result) {
      lines.push(`[—] ${title}: не проверено`)
      continue
    }
    lines.push(`[${STATUS[result.status]}] ${title}: ${result.summary} (${new Date(result.at).toLocaleString('ru-RU')})`)
  }
  return lines.join('\n')
}
