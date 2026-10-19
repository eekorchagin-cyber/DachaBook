import { useState } from 'react'
import { buildReport } from './report'
import { clearResults, useLabResults } from './results'
import { EnexSection } from './sections/EnexSection'
import { EnvSection } from './sections/EnvSection'
import { OfflineSection } from './sections/OfflineSection'
import { PhotoSection } from './sections/PhotoSection'
import { StorageSection } from './sections/StorageSection'
import { YandexSection } from './sections/YandexSection'
import { ActionButton } from '../ui/Section'

export function LabScreen() {
  const results = useLabResults()
  const [notice, setNotice] = useState<string | null>(null)

  const share = async () => {
    const report = await buildReport(results)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'DachaBook — отчёт этапа 1', text: report })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await navigator.clipboard.writeText(report)
    setNotice('Отчёт скопирован — вставьте его в чат.')
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <a href="#/" className="back">
          ← Главная
        </a>
        <h1>Лаборатория проверок</h1>
        <p className="hint">
          Технический прототип (этап 1). Пройдите проверки на iPhone, Mac и Windows и отправьте отчёт с каждого устройства.
        </p>
      </header>
      <EnvSection result={results.env} />
      <StorageSection results={results} />
      <OfflineSection results={results} />
      <PhotoSection results={results} />
      <YandexSection results={results} />
      <EnexSection results={results} />
      <div className="actions report-actions">
        <ActionButton onRun={share}>Отправить отчёт</ActionButton>
        <ActionButton
          secondary
          onRun={async () => {
            await navigator.clipboard.writeText(await buildReport(results))
            setNotice('Отчёт скопирован — вставьте его в чат.')
          }}
        >
          Скопировать
        </ActionButton>
        <ActionButton
          secondary
          onRun={async () => {
            if (confirm('Сбросить результаты проверок на этом устройстве?')) clearResults()
          }}
        >
          Сбросить результаты
        </ActionButton>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </main>
  )
}
