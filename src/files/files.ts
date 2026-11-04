import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo } from 'react'
import { repo } from '../app/store'
import type { StoredFile } from '../domain/types'
import { sha256Hex } from '../lib/hash'
import { makeThumbnail, type Thumbnail } from '../photos/thumbnail'
import { db } from '../storage/db'
import { requestOriginal } from '../sync/runner'

/** Одинаковые файлы (по SHA-256) хранятся один раз и переиспользуются. */
async function findSame(sha256: string, role: StoredFile['role']): Promise<StoredFile | undefined> {
  return (await db.files.where('sha256').equals(sha256).toArray()).find((file) => file.role === role && !file.deletedAt)
}

/** Фото по типу или расширению: перетаскивание из «Фото» и Finder иногда не сообщает тип файла. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif|tiff?|bmp)$/i.test(file.name)
}

export function isHeic(blob: Blob, fileName: string): boolean {
  return /image\/hei[cf]/i.test(blob.type) || /\.hei[cf]$/i.test(fileName)
}

export async function addPhoto(blob: Blob, fileName: string): Promise<StoredFile> {
  const sha256 = await sha256Hex(blob)
  const existing = await findSame(sha256, 'photo')
  if (existing) {
    await keepOriginal(existing.id, blob)
    return existing
  }
  const heic = isHeic(blob, fileName)
  let thumb: Thumbnail | undefined
  try {
    thumb = await makeThumbnail(blob)
  } catch (error) {
    // HEIC умеет показывать Safari, но не Chrome: оригинал сохраняется без миниатюры.
    if (!heic) throw error
  }
  const file = await repo.create('files', {
    role: 'photo',
    fileName,
    mime: blob.type || (heic ? 'image/heic' : 'image/jpeg'),
    size: blob.size,
    sha256,
    width: thumb?.sourceWidth,
    height: thumb?.sourceHeight,
    thumbWidth: thumb?.width,
    thumbHeight: thumb?.height,
    uploadState: 'local',
  })
  await db.fileContents.put({ id: file.id, original: blob, thumb: thumb?.blob })
  return file
}

export async function addAttachment(blob: Blob, fileName: string): Promise<StoredFile> {
  const sha256 = await sha256Hex(blob)
  const existing = await findSame(sha256, 'attachment')
  if (existing) {
    await keepOriginal(existing.id, blob)
    return existing
  }
  const file = await repo.create('files', {
    role: 'attachment',
    fileName,
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    sha256,
    uploadState: 'local',
  })
  await db.fileContents.put({ id: file.id, original: blob })
  return file
}

/** Повторно выбранный файл с тем же содержимым не создаёт вторую запись, но пустую копию заполняет. */
async function keepOriginal(id: string, blob: Blob): Promise<void> {
  const content = await db.fileContents.get(id)
  if (content?.original) return
  await db.fileContents.put({ ...content, id, original: blob })
}

/** Временный адрес содержимого файла для <img> или открытия; освобождается при размонтировании. */
export function useFileUrl(id: string | undefined, variant: 'thumb' | 'original'): string | undefined {
  const content = useLiveQuery(async () => (id ? ((await db.fileContents.get(id)) ?? null) : null), [id])
  const missingOriginal = variant === 'original' && !!id && content !== undefined && !content?.original
  // Оригинала нет на устройстве (пришла только уменьшенная копия) — скачать из облака.
  useEffect(() => {
    if (missingOriginal && id) void requestOriginal(id)
  }, [missingOriginal, id])
  const blob = variant === 'thumb' ? (content?.thumb ?? content?.original) : content?.original
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return url
}

export async function openFile(id: string): Promise<void> {
  let content = await db.fileContents.get(id)
  if (!content?.original) {
    await requestOriginal(id)
    content = await db.fileContents.get(id)
  }
  const meta = await db.files.get(id)
  if (!content?.original) throw new Error('Оригинал файла недоступен на этом устройстве')
  const url = URL.createObjectURL(new Blob([content.original], { type: meta?.mime ?? content.original.type }))
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener'
  if (meta?.fileName) link.download = meta.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
