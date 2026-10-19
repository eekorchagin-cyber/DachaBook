import { useEffect, useState } from 'react'
import { formatBytes, formatMs } from '../../lib/format'
import { saveResult, type LabResult } from '../results'
import { clearLabData, labDataSummary, runBlobTest, runDocsTest, touchMarker, type Marker } from '../storageTests'
import { ActionButton, LogView, Section } from '../../ui/Section'

export function StorageSection({ results }: { results: Record<string, LabResult> }) {
  const blobResult = results['storage-blob-50'] ?? results['storage-blob-5']
  const [log, setLog] = useState<string[]>([])
  const [marker, setMarker] = useState<Marker | null>(null)
  const [summary, setSummary] = useState<{ docs: number; blobs: number; blobBytes: number } | null>(null)
  const add = (line: string) => setLog((lines) => [...lines, line])

  const refresh = async () => setSummary(await labDataSummary())

  useEffect(() => {
    void (async () => {
      const current = await touchMarker()
      setMarker(current)
      const days = Math.floor(current.days)
      saveResult(
        'marker',
        current.days >= 7 ? 'ok' : 'info',
        `Метка первого запуска от ${new Date(current.firstRun).toLocaleString('ru-RU')}: прошло ${days} дн.${current.days >= 7 ? ' Данные сохранились больше недели.' : ' Для проверки нужно открыть приложение не раньше чем через 7 дней.'}`,
      )
      await refresh()
    })()
  }, [])

  return (
    <>
      <Section
        title="Хранилище: записи"
        result={results['storage-docs']}
        hint="Запись 500 документов одной транзакцией и проверка контрольных сумм после чтения."
      >
        <div className="actions">
          <ActionButton
            onRun={async () => {
              const result = await runDocsTest(500)
              const line = `500 документов: запись ${formatMs(result.writeMs)}, чтение ${formatMs(result.readMs)}, повреждено: ${result.corrupted}`
              add(line)
              saveResult('storage-docs', result.corrupted === 0 ? 'ok' : 'fail', line)
              await refresh()
            }}
          >
            Записать 500 документов
          </ActionButton>
        </div>
      </Section>

      <Section
        title="Хранилище: файлы"
        result={blobResult}
        hint="Файл со случайным содержимым записывается в базу и читается обратно со сверкой SHA-256. 50 МБ — как видео из проекта автополива."
      >
        <div className="actions">
          {[5, 50].map((size) => (
            <ActionButton
              key={size}
              onRun={async () => {
                const result = await runBlobTest(size)
                const line = `Файл ${formatBytes(result.size)}: запись ${formatMs(result.writeMs)}, чтение и сверка ${formatMs(result.readMs)}, целостность: ${result.intact ? 'да' : 'НЕТ'}`
                add(line)
                saveResult(`storage-blob-${size}`, result.intact ? 'ok' : 'fail', line)
                await refresh()
              }}
            >
              Файл {size} МБ
            </ActionButton>
          ))}
        </div>
      </Section>

      <Section title="Сохранность данных через неделю" result={results.marker}>
        {marker && (
          <p>
            Первый запуск: {new Date(marker.firstRun).toLocaleString('ru-RU')}. Прошло дней: {Math.floor(marker.days)}.
          </p>
        )}
        <p className="hint">
          Не открывайте приложение на iPhone 7 дней, затем откройте с ярлыка. Если дата первого запуска не изменилась и записи на месте —
          iPhone данные не стёр.
        </p>
        {summary && (
          <p>
            Сейчас в базе проверок: документов {summary.docs}, файлов {summary.blobs} ({formatBytes(summary.blobBytes)}).
          </p>
        )}
        <div className="actions">
          <ActionButton
            secondary
            onRun={async () => {
              await clearLabData()
              add('Тестовые записи и файлы удалены (метка первого запуска сохранена)')
              await refresh()
            }}
          >
            Удалить тестовые данные
          </ActionButton>
        </div>
      </Section>
      <LogView lines={log} />
    </>
  )
}
