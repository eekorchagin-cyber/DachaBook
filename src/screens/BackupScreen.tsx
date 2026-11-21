import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { buildBackup, restoreBackup, type BackupManifest, type RestoreResult } from '../backup/backup'
import { errorText, formatBytes } from '../lib/format'
import { db } from '../storage/db'
import { Screen } from '../ui/Screen'
import { AutoBackupSection } from '../ui/AutoBackup'
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
  references: 'статьи',
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

  const importFile = async (file: File | undefined, input: HTMLInputElement) => {
    if (!file) return
    setError(null)
    setRestored(null)
    try {
      // Читаем сразу: на iPhone после паузы или системного confirm содержимое файла часто становится пустым.
      // Системный confirm на iPhone PWA иногда молча отменяет выбор — поэтому импорт идёт без него.
      const data = await file.arrayBuffer()
      input.value = ''
      setBusy('Импорт копии…')
      const result = await restoreBackup(db, data)
      setRestored(result)
      if (result.added + result.updated + result.files === 0 && result.same === 0) {
        setError(
          `В «${file.name}» не нашлось записей для добавления` +
            (result.corrupted.length ? ` (повреждены: ${result.corrupted.length})` : '') +
            '. Нужен файл dachabook-backup-….zip, не папка и не повторно сжатый архив.',
        )
      }
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen title="Резервная копия" help="backup" back="/more/cloud" tab="/more">
      <section className="card">
        <h2>Экспорт</h2>
        <p className="hint">
          В ZIP попадают все записи дневника, объекты, статьи, план, справочники и уменьшенные копии фото. Личные настройки устройства и пароли
          в копию не входят. Оригиналы фото после выгрузки в облако на телефоне не хранятся — они остаются на Яндекс Диске.
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
              <div className="hint">
                <p>
                  В этот ZIP не вошли оригиналы {exported.manifest.missingOriginals.length} фото и файлов: на этом устройстве их нет — после
                  синхронизации здесь остаются только уменьшенные копии, а полные снимки лежат на Яндекс Диске в папке{' '}
                  <strong>DachaBook/diary/files/originals</strong>.
                </p>
                <p>
                  Записи дневника, план и превью в копии есть. Так и задумано: ZIP остаётся компактным, а оригиналы не дублируются. Для полного
                  восстановления дневника достаточно этой копии и подключённого Яндекс Диска (или скачанных оригиналов).
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <AutoBackupSection />

      <section className="card">
        <h2>Импорт копии</h2>
        <p className="hint">
          Добавляет данные из копии к данным этого устройства: новые записи появятся, одинаковые пропустятся, ничего не удаляется. Если запись по-разному
          изменена здесь и в копии, остаётся версия этого устройства, а расхождение будет в отчёте. Перед импортом сохранится снимок данных этого устройства.
        </p>
        <div className="actions">
          <label className={`button secondary${busy ? ' disabled' : ''}`}>
            {busy === 'Импорт копии…' ? 'Импорт…' : 'Выбрать файл копии (.zip)'}
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream"
              hidden
              disabled={!!busy}
              onChange={(event) => {
                const input = event.currentTarget
                void importFile(input.files?.[0], input)
              }}
            />
          </label>
        </div>
        {restored && (
          <div className="notice">
            <p>
              Добавлено: {restored.added}, обновлено: {restored.updated}, без изменений: {restored.same}, местная версия новее: {restored.keptLocal}, файлов
              восстановлено: {restored.files}.
            </p>
            {!restored.manifest.complete && (
              <p className="hint">
                В импортированной копии не было части оригиналов фото — превью и записи восстановлены. Полные снимки, если они есть, возьмите с
                Яндекс Диска (DachaBook/diary/files/originals) или скачайте нужные в просмотрщике.
              </p>
            )}
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
