import { useMemo, useState } from 'react'
import { repo } from '../../app/store'
import { formatDate } from '../../domain/dates'
import { addAttachment, addPhoto } from '../../files/files'
import { loadDayOneZip, type DayOnePackage } from '../../import/dayone/archive'
import { importDayOne, type DayOneImportResult } from '../../import/dayone/import'
import { dayOneDrafts, dayOneFingerprint, type DayOneDraftOptions } from '../../import/dayone/journal'
import { errorText, formatBytes } from '../../lib/format'
import { db } from '../../storage/db'
import { Screen } from '../../ui/Screen'

interface Loaded {
  file: File
  pack: DayOnePackage
  known: Set<string>
}

function mediaBytes(pack: DayOnePackage, md5s: Iterable<string>): number {
  let total = 0
  for (const md5 of md5s) total += pack.files.get(md5)?.uncompressedSize ?? 0
  return total
}

function uniqueMd5(pack: DayOnePackage, kind: 'photos' | 'videos' | 'pdfAttachments'): { count: number; bytes: number } {
  const ids = new Set<string>()
  for (const entry of pack.entries) {
    for (const item of entry[kind] ?? []) if (item.md5) ids.add(item.md5.toLowerCase())
  }
  return { count: ids.size, bytes: mediaBytes(pack, ids) }
}

export function DayOneScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [photos, setPhotos] = useState(true)
  const [videos, setVideos] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DayOneImportResult | null>(null)

  const options: DayOneDraftOptions = { photos, videos }
  const summary = useMemo(() => {
    if (!loaded) return null
    const built = dayOneDrafts(loaded.pack.entries, options)
    const fresh = built.drafts.filter((draft) => !loaded.known.has(dayOneFingerprint(draft.uuid)))
    const dates = built.drafts.map((draft) => draft.date).sort()
    return {
      ...built,
      fresh: fresh.length,
      already: built.drafts.length - fresh.length,
      from: dates[0],
      to: dates[dates.length - 1],
      photo: uniqueMd5(loaded.pack, 'photos'),
      video: uniqueMd5(loaded.pack, 'videos'),
      pdf: uniqueMd5(loaded.pack, 'pdfAttachments'),
    }
  }, [loaded, photos, videos])

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setResult(null)
    setLoaded(null)
    setProgress('Читаю описание архива…')
    try {
      const pack = await loadDayOneZip(file)
      const known = new Set<string>()
      for (const event of await db.events.toArray()) {
        if (event.source?.app === 'dayone' && event.source.fingerprint) known.add(event.source.fingerprint)
      }
      setLoaded({ file, pack, known })
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setProgress(null)
    }
  }

  const run = async () => {
    if (!loaded || !summary) return
    setError(null)
    setResult(null)
    try {
      const imported = await importDayOne(loaded.pack, loaded.file.name, options, {
        blob: loaded.file,
        repo,
        database: db,
        files: {
          photo: async (blob, name) => (await addPhoto(blob, name)).id,
          attachment: async (blob, name) => (await addAttachment(blob, name)).id,
        },
        onProgress: (state) => {
          const label = state.phase === 'files' ? 'Файлы' : 'Записи'
          setProgress(`${label}: ${state.done} из ${state.total}`)
        },
      })
      setResult(imported)
      setLoaded(null)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setProgress(null)
    }
  }

  if (result) {
    return (
      <Screen title="Импорт из Day One" help="dayone" back="/more/service" tab="/more">
        <section className="card">
          <h2>Импорт завершён</h2>
          <ul>
            <li>Записей дневника: {result.events}</li>
            <li>Уже были и пропущены: {result.skipped}</li>
            <li>Файлов: {result.files}</li>
            {result.missing > 0 && <li>Не найдено в архиве: {result.missing}</li>}
          </ul>
          <p className="hint">Перед импортом сохранён снимок данных. Записи лежат в дневнике как наблюдения.</p>
          {result.errors.length > 0 && (
            <>
              <h3>Не скопировано ({result.errors.length})</h3>
              <ul className="small">
                {result.errors.slice(0, 30).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            <a className="button" href="#/diary">
              Открыть дневник
            </a>
          </div>
        </section>
      </Screen>
    )
  }

  return (
    <Screen title="Импорт из Day One" help="dayone" back="/more/service" tab="/more">
      <section className="card">
        <h2>Архив JSON.zip</h2>
        <p className="hint">
          В Day One: журнал → экспорт → JSON в Zip. Подойдёт и файл вида «дата-название.zip». Фото и текст читаются на этом устройстве и никуда не отправляются.
        </p>
        <div className="actions">
          <label className="button">
            Выбрать архив
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void readFile(file)
              }}
            />
          </label>
        </div>
        {progress && <p className="hint">{progress}</p>}
        {error && <p className="error">{error}</p>}
      </section>
      {loaded && summary && (
        <section className="card">
          <h2>{loaded.pack.journalName || loaded.file.name}</h2>
          <p className="small">
            {loaded.file.name} — {formatBytes(loaded.file.size)}. Записей в файле: {loaded.pack.entries.length}. К переносу: {summary.fresh}. Уже в дневнике:{' '}
            {summary.already}. Пустых дней: {summary.skippedEmpty}.
          </p>
          {summary.from && (
            <p className="small">
              С {formatDate(summary.from)} по {formatDate(summary.to)}.
            </p>
          )}
          <label className="import-check">
            <input type="checkbox" checked={photos} disabled={!!progress} onChange={(event) => setPhotos(event.target.checked)} />
            Фото: {summary.photo.count}
            {summary.photo.bytes > 0 ? `, ${formatBytes(summary.photo.bytes)}` : ''}
          </label>
          <label className="import-check">
            <input type="checkbox" checked={videos} disabled={!!progress} onChange={(event) => setVideos(event.target.checked)} />
            Видео: {summary.video.count}
            {summary.video.bytes > 0 ? `, ${formatBytes(summary.video.bytes)}` : ''}
          </label>
          {summary.pdf.count > 0 && <p className="small">PDF: {summary.pdf.count} — во вложения.</p>}
          <p className="hint">Запись становится наблюдением. Объект участка можно выбрать позже, открыв её в дневнике. Видео по умолчанию выключены: они тяжёлые.</p>
          <div className="actions">
            <button type="button" className="button" disabled={!!progress || summary.fresh === 0} onClick={() => void run()}>
              {progress ?? `Импортировать (${summary.fresh})`}
            </button>
          </div>
        </section>
      )}
    </Screen>
  )
}
