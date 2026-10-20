import { YandexDisk } from '../cloud/yandexDisk'
import { errorText, formatBytes, formatMs } from '../lib/format'
import { sha256Hex } from '../lib/hash'

const LAB_ROOT = 'disk:/DachaBook/lab'

export type StepLog = (line: string) => void

function randomBlob(bytes: number): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < bytes; offset += 65536) {
    parts.push(crypto.getRandomValues(new Uint8Array(Math.min(65536, bytes - offset))))
  }
  return new Blob(parts, { type: 'application/octet-stream' })
}

async function timed<T>(action: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now()
  const result = await action()
  return [result, performance.now() - start]
}

async function verifyRemote(disk: YandexDisk, path: string, sha256: string): Promise<boolean> {
  const meta = await disk.meta(path)
  return meta.sha256 === sha256
}

function runStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/** Удаляет остатки оборванных прогонов старше часа; свежие папки могут принадлежать параллельному прогону. */
async function removeStaleRuns(disk: YandexDisk, log: StepLog): Promise<void> {
  const cutoff = runStamp(new Date(Date.now() - 3_600_000))
  let removed = 0
  for (const item of await disk.list(LAB_ROOT)) {
    if (item.type === 'dir' && item.name >= cutoff) continue
    await disk.remove(`${LAB_ROOT}/${item.name}`)
    removed++
  }
  if (removed > 0) log(`Удалены остатки прошлых прогонов: ${removed}`)
}

/** Полный сценарий проверки Яндекс Диска; бросает исключение на первом сбое. */
export async function runYandexSuite(disk: YandexDisk, log: StepLog, photo?: Blob): Promise<void> {
  // Своя подпапка на каждый прогон: проверки с нескольких устройств одновременно не мешают друг другу.
  const folder = `${LAB_ROOT}/${runStamp(new Date())}-${crypto.randomUUID().slice(0, 8)}`
  const [info, infoMs] = await timed(() => disk.info())
  log(`Вход: ${info.user?.login ?? '—'}, занято ${formatBytes(info.used_space)} из ${formatBytes(info.total_space)} (${formatMs(infoMs)})`)

  await disk.ensureFolder(LAB_ROOT)
  await removeStaleRuns(disk, log)
  await disk.ensureFolder(folder)
  log(`Папка ${folder} готова`)

  let failures = 0
  const onFailure = (what: string) => (attempt: number, elapsedMs: number, error: unknown) => {
    failures++
    log(`${what}, попытка ${attempt}: сбой через ${formatMs(elapsedMs)} — ${errorText(error)}`)
  }
  const put = (name: string, blob: Blob) =>
    timed(() => disk.uploadWithRetry(`${folder}/${name}`, blob, { onFailure: onFailure(`Загрузка ${name}`) }))
  const get = async (name: string): Promise<[Blob, number]> => {
    const [[blob], ms] = await timed(() => disk.downloadWithRetry(`${folder}/${name}`, { onFailure: onFailure(`Скачивание ${name}`) }))
    return [blob, ms]
  }

  const doc = JSON.stringify({ id: crypto.randomUUID(), schemaVersion: 1, comment: 'Проверка записи документа' })
  const docBlob = new Blob([doc], { type: 'application/json' })
  const [, docUpMs] = await put('doc.json', docBlob)
  const [downloaded, docDownMs] = await get('doc.json')
  const docOk = (await downloaded.text()) === doc
  log(`JSON-документ: загрузка ${formatMs(docUpMs)}, скачивание ${formatMs(docDownMs)}, совпадает: ${docOk ? 'да' : 'НЕТ'}`)
  if (!docOk) throw new Error('Скачанный документ отличается от загруженного')

  const file = randomBlob(5 * 1024 * 1024)
  const fileSha = await sha256Hex(file)
  const [, fileUpMs] = await put('file-5mb.bin', file)
  const remoteOk = await verifyRemote(disk, `${folder}/file-5mb.bin`, fileSha)
  const [fileBack, fileDownMs] = await get('file-5mb.bin')
  const backOk = (await sha256Hex(fileBack)) === fileSha
  log(`Файл 5 МБ: загрузка ${formatMs(fileUpMs)}, скачивание ${formatMs(fileDownMs)}, SHA-256 на Диске ${remoteOk ? 'совпал' : 'НЕ совпал'}, после скачивания ${backOk ? 'совпал' : 'НЕ совпал'}`)
  if (!remoteOk || !backOk) throw new Error('Контрольная сумма файла не совпала')

  if (photo) {
    const photoSha = await sha256Hex(photo)
    const [, photoMs] = await put('photo.jpg', photo)
    const photoOk = await verifyRemote(disk, `${folder}/photo.jpg`, photoSha)
    log(`Фото из проверки фотографий (${formatBytes(photo.size)}): загрузка ${formatMs(photoMs)}, SHA-256 ${photoOk ? 'совпал' : 'НЕ совпал'}`)
    if (!photoOk) throw new Error('Контрольная сумма фото не совпала')
  }

  const big = randomBlob(20 * 1024 * 1024)
  const bigSha = await sha256Hex(big)
  const controller = new AbortController()
  const abortTimer = setTimeout(() => controller.abort(), 700)
  let interrupted = false
  try {
    await disk.upload(`${folder}/file-20mb.bin`, big, controller.signal)
  } catch (error) {
    interrupted = error instanceof DOMException && error.name === 'AbortError'
    if (!interrupted) throw error
  } finally {
    clearTimeout(abortTimer)
  }
  log(interrupted ? 'Файл 20 МБ: загрузка намеренно оборвана' : 'Файл 20 МБ: загрузка успела завершиться до обрыва (быстрая сеть)')
  const [usedAttempts, retryMs] = await put('file-20mb.bin', big)
  const retryOk = await verifyRemote(disk, `${folder}/file-20mb.bin`, bigSha)
  log(`Повторная загрузка 20 МБ: удалась с попытки ${usedAttempts}, всего ${formatMs(retryMs)}, SHA-256 ${retryOk ? 'совпал' : 'НЕ совпал'}`)
  if (!retryOk) throw new Error('После повтора файл на Диске повреждён')
  const [bigBack, bigDownMs] = await get('file-20mb.bin')
  const bigBackOk = (await sha256Hex(bigBack)) === bigSha
  log(`Скачивание 20 МБ через посредника: ${formatMs(bigDownMs)}, SHA-256 ${bigBackOk ? 'совпал' : 'НЕ совпал'}`)
  if (!bigBackOk) throw new Error('Скачанный файл 20 МБ отличается от загруженного')

  const items = await disk.list(folder)
  log(`В папке файлов: ${items.length} (${items.map((item) => item.name).join(', ')})`)

  await disk.remove(folder)
  log(`Тестовая папка удалена. Неудачных попыток за прогон: ${failures}`)
}
