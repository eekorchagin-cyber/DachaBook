import { useState } from 'react'
import { missingMediaHashes, parseEnexStream } from '../../import/enex/parser'
import { errorText, formatBytes, formatMs } from '../../lib/format'
import { labDb } from '../labDb'
import { saveResult, type LabResult } from '../results'
import { LogView, Section } from '../../ui/Section'

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number }
}

function heapUsed(): number | undefined {
  return (performance as PerformanceWithMemory).memory?.usedJSHeapSize
}

export function EnexSection({ results }: { results: Record<string, LabResult> }) {
  const [log, setLog] = useState<string[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [storeResources, setStoreResources] = useState(false)

  const handle = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const start = performance.now()
      const heapBefore = heapUsed()
      let resources = 0
      let resourceBytes = 0
      let missing = 0
      let tables = 0
      let todos = 0
      let notes = 0
      try {
        for await (const note of parseEnexStream(file.stream(), (p) =>
          setProgress(`${file.name}: прочитано ${formatBytes(p.bytesRead)} из ${formatBytes(file.size)}`),
        )) {
          notes++
          missing += missingMediaHashes(note).length
          tables += (note.content.match(/<table\b/g) ?? []).length
          todos += (note.content.match(/<en-todo\b/g) ?? []).length
          for (const resource of note.resources) {
            resources++
            resourceBytes += resource.size
            if (storeResources) {
              await labDb.blobs.put({
                id: crypto.randomUUID(),
                kind: 'enex-resource',
                name: resource.fileName ?? resource.md5,
                type: resource.mime,
                size: resource.size,
                sha256: '',
                data: resource.data,
                createdAt: new Date().toISOString(),
              })
            }
          }
        }
        const heapAfter = heapUsed()
        const heap = heapBefore !== undefined && heapAfter !== undefined ? `, память +${formatBytes(Math.max(0, heapAfter - heapBefore))}` : ''
        const line = `${file.name} (${formatBytes(file.size)}): заметок ${notes}, таблиц ${tables}, флажков ${todos}, вложений ${resources} (${formatBytes(resourceBytes)})${storeResources ? ', вложения сохранены в базу' : ''}, потерянных ссылок на вложения ${missing}, время ${formatMs(performance.now() - start)}${heap}`
        setLog((lines) => [...lines, line])
        saveResult('enex', missing === 0 ? 'ok' : 'warn', line)
      } catch (error) {
        const line = `${file.name} (${formatBytes(file.size)}): ошибка разбора — ${errorText(error)}`
        setLog((lines) => [...lines, line])
        saveResult('enex', 'fail', line)
      } finally {
        setProgress(null)
      }
    }
  }

  return (
    <Section
      title="Разбор файлов Evernote (ENEX)"
      result={results.enex}
      hint="Выберите один или несколько файлов ENEX. Ничего не импортируется: проверяется только, что телефон или компьютер справляется с разбором. Главная проверка на iPhone — «Проект системы автополива» (75 МБ)."
    >
      <label className="checkbox">
        <input type="checkbox" checked={storeResources} onChange={(event) => setStoreResources(event.target.checked)} />
        Сохранять вложения в базу (проверка записи крупных файлов, например видео 46 МБ)
      </label>
      <div className="actions">
        <label className="button">
          Выбрать файлы ENEX
          <input type="file" multiple hidden onChange={(event) => void handle(event.target.files)} />
        </label>
      </div>
      {progress && <p className="hint">{progress}</p>}
      <LogView lines={log} />
    </Section>
  )
}
