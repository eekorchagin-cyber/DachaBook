import { sha256Hex } from '../lib/hash'
import { labDb, type LabDoc } from './labDb'

export interface DocsTestResult {
  count: number
  writeMs: number
  readMs: number
  corrupted: number
}

export async function runDocsTest(count: number): Promise<DocsTestResult> {
  const docs: LabDoc[] = []
  for (let i = 0; i < count; i++) {
    const body = JSON.stringify({
      type: 'event',
      date: `2025-05-${String((i % 28) + 1).padStart(2, '0')}`,
      comment: `Тестовая запись ${i}: газон прочесан, удобрен, полив 2 раза по 20 минут.`,
    })
    docs.push({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      revision: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      body,
      checksum: await sha256Hex(body),
    })
  }
  const writeStart = performance.now()
  await labDb.transaction('rw', labDb.docs, async () => {
    await labDb.docs.bulkPut(docs)
  })
  const writeMs = performance.now() - writeStart

  const readStart = performance.now()
  const stored = await labDb.docs.bulkGet(docs.map((doc) => doc.id))
  const readMs = performance.now() - readStart
  let corrupted = 0
  for (const doc of stored) {
    if (!doc || (await sha256Hex(doc.body)) !== doc.checksum) corrupted++
  }
  return { count, writeMs, readMs, corrupted }
}

function randomBlob(bytes: number): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = []
  const chunk = 65536
  for (let offset = 0; offset < bytes; offset += chunk) {
    parts.push(crypto.getRandomValues(new Uint8Array(Math.min(chunk, bytes - offset))))
  }
  return new Blob(parts, { type: 'application/octet-stream' })
}

export interface BlobTestResult {
  size: number
  writeMs: number
  readMs: number
  intact: boolean
}

export async function runBlobTest(megabytes: number): Promise<BlobTestResult> {
  const data = randomBlob(megabytes * 1024 * 1024)
  const sha256 = await sha256Hex(data)
  const id = crypto.randomUUID()
  const writeStart = performance.now()
  await labDb.transaction('rw', labDb.blobs, async () => {
    await labDb.blobs.put({
      id,
      kind: 'random',
      name: `random-${megabytes}mb.bin`,
      type: data.type,
      size: data.size,
      sha256,
      data,
      createdAt: new Date().toISOString(),
    })
  })
  const writeMs = performance.now() - writeStart
  const readStart = performance.now()
  const stored = await labDb.blobs.get(id)
  const intact = !!stored && stored.data.size === data.size && (await sha256Hex(stored.data)) === sha256
  const readMs = performance.now() - readStart
  return { size: data.size, writeMs, readMs, intact }
}

export interface Marker {
  firstRun: string
  lastOpen?: string
  days: number
}

/** Метка первого запуска: по ней через неделю видно, не стёр ли браузер данные. */
export async function touchMarker(): Promise<Marker> {
  const now = new Date().toISOString()
  const [first, last] = await Promise.all([labDb.meta.get('firstRun'), labDb.meta.get('lastOpen')])
  if (!first) await labDb.meta.put({ key: 'firstRun', value: now })
  await labDb.meta.put({ key: 'lastOpen', value: now })
  const firstRun = first?.value ?? now
  const days = (Date.now() - Date.parse(firstRun)) / 86_400_000
  return { firstRun, lastOpen: last?.value, days }
}

export async function labDataSummary(): Promise<{ docs: number; blobs: number; blobBytes: number }> {
  const blobs = await labDb.blobs.toArray()
  return {
    docs: await labDb.docs.count(),
    blobs: blobs.length,
    blobBytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
  }
}

export async function clearLabData(): Promise<void> {
  await labDb.transaction('rw', labDb.docs, labDb.blobs, async () => {
    await labDb.docs.clear()
    await labDb.blobs.clear()
  })
}
