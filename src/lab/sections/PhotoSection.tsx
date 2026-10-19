import { useEffect, useState } from 'react'
import { formatBytes, formatMs } from '../../lib/format'
import { sha256Hex } from '../../lib/hash'
import { makeThumbnail } from '../../photos/thumbnail'
import { labDb } from '../labDb'
import { saveResult, type LabResult } from '../results'
import { LogView, Section } from '../../ui/Section'

async function storePhoto(file: File): Promise<{ line: string; thumbUrl: string; ok: boolean }> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
  const start = performance.now()
  const thumb = await makeThumbnail(file)
  const thumbMs = performance.now() - start
  const [originalSha, thumbSha] = await Promise.all([sha256Hex(file), sha256Hex(thumb.blob)])
  const createdAt = new Date().toISOString()
  const originalId = crypto.randomUUID()
  await labDb.transaction('rw', labDb.blobs, async () => {
    await labDb.blobs.bulkPut([
      { id: originalId, kind: 'photo-original', name: file.name, type: file.type, size: file.size, sha256: originalSha, data: file, createdAt },
      { id: crypto.randomUUID(), kind: 'photo-thumb', name: `${file.name}.thumb.jpg`, type: thumb.blob.type, size: thumb.blob.size, sha256: thumbSha, data: thumb.blob, createdAt },
    ])
  })
  const stored = await labDb.blobs.get(originalId)
  const ok = !!stored && (await sha256Hex(stored.data)) === originalSha
  return {
    ok,
    thumbUrl: URL.createObjectURL(thumb.blob),
    line: `${file.name || 'без имени'}: тип ${file.type || 'не указан'}${isHeic ? ' (HEIC)' : ''}, ${formatBytes(file.size)}, ${thumb.sourceWidth}×${thumb.sourceHeight}; уменьшенная копия ${thumb.width}×${thumb.height}, ${formatBytes(thumb.blob.size)} за ${formatMs(thumbMs)}; оригинал сохранён без изменений: ${ok ? 'да' : 'НЕТ'}`,
  }
}

export function PhotoSection({ results }: { results: Record<string, LabResult> }) {
  const [log, setLog] = useState<string[]>([])
  const [thumbs, setThumbs] = useState<string[]>([])

  useEffect(() => () => thumbs.forEach((url) => URL.revokeObjectURL(url)), [thumbs])

  const handle = async (files: FileList | null, source: string) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const result = await storePhoto(file)
        setLog((lines) => [...lines, `${source}: ${result.line}`])
        setThumbs((urls) => [...urls, result.thumbUrl])
        saveResult('photos', result.ok ? 'ok' : 'fail', `${source}: ${result.line}`)
      } catch (error) {
        const line = `${source}: ${file.name} (${file.type || 'тип не указан'}) — не удалось обработать: ${error instanceof Error ? error.message : String(error)}`
        setLog((lines) => [...lines, line])
        saveResult('photos', 'fail', line)
      }
    }
  }

  return (
    <Section
      title="Фотографии"
      result={results.photos}
      hint="Выберите снимок из фототеки и сделайте снимок камерой. Проверяется формат (HEIC/JPEG), создание уменьшенной копии и сохранение оригинала без изменений."
    >
      <div className="actions">
        <label className="button">
          Из фототеки или файлов
          <input type="file" accept="image/*" multiple hidden onChange={(event) => void handle(event.target.files, 'Фототека')} />
        </label>
        <label className="button">
          Камера
          <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => void handle(event.target.files, 'Камера')} />
        </label>
      </div>
      {thumbs.length > 0 && (
        <div className="thumbs">
          {thumbs.map((url) => (
            <img key={url} src={url} alt="Уменьшенная копия" />
          ))}
        </div>
      )}
      <LogView lines={log} />
    </Section>
  )
}
