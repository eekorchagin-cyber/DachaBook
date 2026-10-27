/** Входящие фото из «Поделиться» или из выбора в Медиатеке: отдельный кэш, его не трогает обновление офлайн-копии. */
const INBOX = 'share-inbox'

export interface InboxItem {
  key: string
  name: string
  type: string
  blob: Blob
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof File !== 'undefined' && value instanceof File && value.size > 0
}

export async function readInbox(): Promise<InboxItem[]> {
  if (!('caches' in globalThis)) return []
  const cache = await caches.open(INBOX)
  const items: InboxItem[] = []
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    if (!response || (response.headers.get('Content-Type') ?? '').startsWith('text/plain')) continue
    const blob = await response.blob()
    if (blob.size === 0) continue
    const name = decodeURIComponent(response.headers.get('X-Filename') || request.url.split('/').pop() || 'photo.jpg')
    items.push({ key: request.url, name, type: blob.type || 'application/octet-stream', blob })
  }
  return items
}

export async function readInboxCaption(): Promise<string> {
  if (!('caches' in globalThis)) return ''
  const response = await (await caches.open(INBOX)).match('./inbox/caption')
  return response ? await response.text() : ''
}

export async function addToInbox(files: File[]): Promise<void> {
  if (!('caches' in globalThis) || files.length === 0) return
  const cache = await caches.open(INBOX)
  let index = (await cache.keys()).length
  for (const file of files) {
    if (file.size === 0) continue
    index++
    await cache.put(
      `./inbox/${Date.now()}-${index}-${encodeURIComponent(file.name || 'photo.jpg')}`,
      new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'photo.jpg') } }),
    )
  }
}

export async function addFormDataToInbox(formData: FormData): Promise<number> {
  const files = ['photos', 'file', 'media', 'image']
    .flatMap((name) => formData.getAll(name))
    .filter(isFile)
  const unique = files.length > 0 ? files : [...formData.values()].filter(isFile)
  await addToInbox(unique)
  const caption = [formData.get('title'), formData.get('text'), formData.get('url')].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n')
  if (caption) {
    const cache = await caches.open(INBOX)
    await cache.put('./inbox/caption', new Response(caption, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
  }
  return unique.length
}

export async function removeInboxItem(key: string): Promise<void> {
  if (!('caches' in globalThis)) return
  await (await caches.open(INBOX)).delete(key)
}

export async function clearInbox(): Promise<void> {
  if (!('caches' in globalThis)) return
  await caches.delete(INBOX)
}

export async function inboxHasFiles(): Promise<boolean> {
  return (await readInbox()).length > 0
}
