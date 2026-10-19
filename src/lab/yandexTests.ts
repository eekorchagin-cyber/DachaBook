import { YandexDisk } from '../cloud/yandexDisk'
import { formatBytes, formatMs } from '../lib/format'
import { sha256Hex } from '../lib/hash'

const LAB_FOLDER = 'disk:/DachaBook/lab'

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

/** Полный сценарий проверки Яндекс Диска; бросает исключение на первом сбое. */
export async function runYandexSuite(disk: YandexDisk, log: StepLog, photo?: Blob): Promise<void> {
  const [info, infoMs] = await timed(() => disk.info())
  log(`Вход: ${info.user?.login ?? '—'}, занято ${formatBytes(info.used_space)} из ${formatBytes(info.total_space)} (${formatMs(infoMs)})`)

  await disk.ensureFolder(LAB_FOLDER)
  log(`Папка ${LAB_FOLDER} готова`)

  const doc = JSON.stringify({ id: crypto.randomUUID(), schemaVersion: 1, comment: 'Проверка записи документа' })
  const docBlob = new Blob([doc], { type: 'application/json' })
  const [, docUpMs] = await timed(() => disk.upload(`${LAB_FOLDER}/doc.json`, docBlob))
  const [downloaded, docDownMs] = await timed(() => disk.download(`${LAB_FOLDER}/doc.json`))
  const docOk = (await downloaded.text()) === doc
  log(`JSON-документ: загрузка ${formatMs(docUpMs)}, скачивание ${formatMs(docDownMs)}, совпадает: ${docOk ? 'да' : 'НЕТ'}`)
  if (!docOk) throw new Error('Скачанный документ отличается от загруженного')

  const file = randomBlob(5 * 1024 * 1024)
  const fileSha = await sha256Hex(file)
  const [, fileUpMs] = await timed(() => disk.upload(`${LAB_FOLDER}/file-5mb.bin`, file))
  const remoteOk = await verifyRemote(disk, `${LAB_FOLDER}/file-5mb.bin`, fileSha)
  const [fileBack, fileDownMs] = await timed(() => disk.download(`${LAB_FOLDER}/file-5mb.bin`))
  const backOk = (await sha256Hex(fileBack)) === fileSha
  log(`Файл 5 МБ: загрузка ${formatMs(fileUpMs)}, скачивание ${formatMs(fileDownMs)}, SHA-256 на Диске ${remoteOk ? 'совпал' : 'НЕ совпал'}, после скачивания ${backOk ? 'совпал' : 'НЕ совпал'}`)
  if (!remoteOk || !backOk) throw new Error('Контрольная сумма файла не совпала')

  if (photo) {
    const photoSha = await sha256Hex(photo)
    const [, photoMs] = await timed(() => disk.upload(`${LAB_FOLDER}/photo.jpg`, photo))
    const photoOk = await verifyRemote(disk, `${LAB_FOLDER}/photo.jpg`, photoSha)
    log(`Фото из проверки фотографий (${formatBytes(photo.size)}): загрузка ${formatMs(photoMs)}, SHA-256 ${photoOk ? 'совпал' : 'НЕ совпал'}`)
    if (!photoOk) throw new Error('Контрольная сумма фото не совпала')
  }

  const big = randomBlob(20 * 1024 * 1024)
  const bigSha = await sha256Hex(big)
  const controller = new AbortController()
  const abortTimer = setTimeout(() => controller.abort(), 700)
  let interrupted = false
  try {
    await disk.upload(`${LAB_FOLDER}/file-20mb.bin`, big, controller.signal)
  } catch (error) {
    interrupted = error instanceof DOMException && error.name === 'AbortError'
    if (!interrupted) throw error
  } finally {
    clearTimeout(abortTimer)
  }
  log(interrupted ? 'Файл 20 МБ: загрузка намеренно оборвана' : 'Файл 20 МБ: загрузка успела завершиться до обрыва (быстрая сеть)')
  const [, retryMs] = await timed(() => disk.upload(`${LAB_FOLDER}/file-20mb.bin`, big))
  const retryOk = await verifyRemote(disk, `${LAB_FOLDER}/file-20mb.bin`, bigSha)
  log(`Повторная загрузка 20 МБ: ${formatMs(retryMs)}, SHA-256 ${retryOk ? 'совпал' : 'НЕ совпал'}`)
  if (!retryOk) throw new Error('После повтора файл на Диске повреждён')

  const items = await disk.list(LAB_FOLDER)
  log(`В папке файлов: ${items.length} (${items.map((item) => item.name).join(', ')})`)

  await disk.remove(LAB_FOLDER)
  log('Тестовая папка удалена')
}
