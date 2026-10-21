import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { buildBackup, restoreBackup, type BackupManifest, type RestoreResult } from '../backup/backup'
import { errorText, formatBytes } from '../lib/format'
import { db } from '../storage/db'
import { Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

/** На iPhone — системное меню «Поделиться» (только файл, без текста: иначе скрываются «Файлы» и Яндекс Диск), иначе скачивание. */
async function shareOrDownload(blob: Blob, fileName: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], fileName, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Отправка отменена — копия не сохранена')
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

const LABELS: Record<string, string> = {
  objects: 'объекты',
  plantGroups: 'группы растений',
  events: 'записи дневника',
  references: 'справочные материалы',
  planDrafts: 'позиции плана',
  importArchive: 'архив импорта',
  files: 'фото и файлы',
}

function Counts({ counts }: { counts: Record<string, number> }) {
  return <p className="small">{Object.entries(counts).map(([key, value]) => `${LABELS[key] ?? key}: ${value}`).join(' · ')}</p>
}

export function BackupScreen() {
  const lastBackup = useLiveQuery(() => db.settings.get('lastBackupAt'), [])
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('createdAt').reverse().toArray(), []) ?? []
  const [exported, setExported] = useState<{ manifest: BackupManifest; size: number; how: string } | null>(null)
  const [restored, setRestored] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setRestored(null)
    try {
      // Файл читается до диалога подтверждения: на iPhone после диалога содержимое может оказаться пустым.
      const data = await file.arrayBuffer()
      if (!confirm(`Импортировать «${file.name}» (${formatBytes(file.size)})? Новые записи добавятся, существующие не удалятся. Перед импортом сохранится снимок данных.`)) return
      setBusy('Импорт копии…')
      setRestored(await restoreBackup(db, data))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen title="Резервная копия" help="backup" back="/more" tab="/more">
      <section className="card">
        <h2>Экспорт</h2>
        <p className="hint">
          Все записи, объекты, справочник, черновик плана, архив импорта, оригиналы фото и вложения — в одном ZIP-архиве. Каждая запись — отдельный
          JSON-файл. Личные настройки устройства и пароли в копию не входят.
        </p>
        <p className="small">
          Последняя копия: {lastBackup?.value ? new Date(lastBackup.value as string).toLocaleString('ru-RU') : 'ещё не создавалась'}
        </p>
        <div className="actions">
          <ActionButton
            onRun={async () => {
              setError(null)
              setBusy('Создание копии…')
              try {
                const { blob, fileName, manifest } = await buildBackup(db, __APP_VERSION__)
                const how = await shareOrDownload(blob, fileName)
                await db.settings.put({ key: 'lastBackupAt', value: manifest.exportedAt })
                setExported({ manifest, size: blob.size, how })
              } finally {
                setBusy(null)
              }
            }}
          >
            Создать резервную копию
          </ActionButton>
        </div>
        {exported && (
          <div className="notice">
            <p>
              Копия {exported.how === 'shared' ? 'передана' : 'сохранена в «Загрузки»'}: {formatBytes(exported.size)}.
            </p>
            <Counts counts={exported.manifest.counts} />
            {!exported.manifest.complete && (
              <p className="error">Копия неполная: нет оригиналов у файлов ({exported.manifest.missingOriginals.length}). Остальное сохранено.</p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Импорт копии</h2>
        <p className="hint">
          Добавляет данные из копии к данным этого устройства: новые записи появятся, одинаковые пропустятся, ничего не удаляется. Если запись по-разному
          изменена здесь и в копии, остаётся версия этого устройства, а расхождение будет в отчёте.
        </p>
        <div className="actions">
          <label className="button secondary">
            Выбрать файл копии (.zip)
            <input type="file" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
          </label>
        </div>
        {restored && (
          <div className="notice">
            <p>
              Добавлено: {restored.added}, обновлено: {restored.updated}, без изменений: {restored.same}, местная версия новее: {restored.keptLocal}, файлов
              восстановлено: {restored.files}.
            </p>
            {!restored.manifest.complete && <p className="error">Копия была неполной: в ней не было части оригиналов файлов.</p>}
            {restored.conflicts.length > 0 && (
              <p className="error">Расхождения (оставлена версия этого устройства): {restored.conflicts.join('; ')}</p>
            )}
            {restored.corrupted.length > 0 && <p className="error">Повреждены и не загружены: {restored.corrupted.join('; ')}</p>}
          </div>
        )}
      </section>

      {busy && <p className="hint">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {snapshots.length > 0 && (
        <section className="card">
          <h2>Снимки перед импортом</h2>
          <p className="hint">Автоматические снимки данных перед импортом из Evernote и из резервной копии хранятся на этом устройстве (последние пять).</p>
          <ul className="list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="plan-item">
                <strong>{new Date(snapshot.createdAt).toLocaleString('ru-RU')}</strong> — {snapshot.reason}
                <Counts counts={snapshot.counts} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
