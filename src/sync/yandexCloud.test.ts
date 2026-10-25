import { afterEach, describe, expect, it, vi } from 'vitest'
import { withRetry, YandexDiskError } from '../cloud/yandexDisk'
import { YandexAuthError, YandexCloud } from './yandexCloud'

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockFetch(handler: Handler) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.searchParams.get('offset') ? `@${url.searchParams.get('offset')}` : ''}`)
    return handler(url, init)
  })
  return calls
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const item = (name: string, modified: string) => ({ name, type: 'file', md5: `md5-${name}`, modified })

afterEach(() => vi.unstubAllGlobals())

describe('адаптер Яндекс Диска', () => {
  it('получает изменения постранично и останавливается на файлах старше курсора (с запасом 2 минуты)', async () => {
    const files = Array.from({ length: 250 }, (_, index) => item(`${index}.json`, new Date(Date.UTC(2026, 9, 25, 12, 0, 0) - index * 60_000).toISOString()))
    const calls = mockFetch((url) => {
      const offset = Number(url.searchParams.get('offset'))
      expect(url.searchParams.get('sort')).toBe('-modified')
      return json({ _embedded: { items: files.slice(offset, offset + 200) } })
    })
    const cloud = new YandexCloud('token')
    const all = await cloud.listChanges('docs/events')
    expect(all.entries).toHaveLength(250)
    expect(all.complete).toBe(true)
    expect(all.cursor).toBe('2026-10-25T12:00:00.000Z')
    expect(calls).toHaveLength(2)

    const recent = await cloud.listChanges('docs/events', '2026-10-25T11:55:00.000Z')
    expect(recent.entries.map((entry) => entry.name)).toEqual(['0.json', '1.json', '2.json', '3.json', '4.json', '5.json', '6.json', '7.json'])
    expect(recent.entries[0]).toMatchObject({ path: 'docs/events/0.json', md5: 'md5-0.json' })
    expect(recent.complete).toBe(false)
  })

  it('отсутствующая папка — пустой список; отсутствующий файл — null', async () => {
    mockFetch(() => json({ error: 'DiskNotFoundError', message: 'Не удалось найти запрошенный ресурс.' }, 404))
    const cloud = new YandexCloud('token')
    expect(await cloud.listChanges('docs/folkSigns')).toEqual({ entries: [], cursor: undefined, complete: true })
    expect(await cloud.stat('dachabook.json')).toBeNull()
    expect(await cloud.read('dachabook.json')).toBeNull()
  })

  it('при записи в несуществующую папку создаёт её и повторяет загрузку', async () => {
    let folderCreated = false
    const uploaded: string[] = []
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/resources/upload')) {
        if (!folderCreated) return json({ error: 'DiskPathDoesntExistsError', message: 'Указанного пути не существует.' }, 409)
        return json({ href: 'https://uploader.disk.yandex.net/put/1', method: 'PUT' })
      }
      if (url.pathname.endsWith('/resources') && init?.method === 'PUT') {
        if (url.searchParams.get('path') === 'disk:/DachaBook/diary/docs/events') folderCreated = true
        return json({ href: '' }, 201)
      }
      if (url.host === 'uploader.disk.yandex.net') {
        uploaded.push(url.pathname)
        return new Response(null, { status: 201 })
      }
      throw new Error(`unexpected ${url}`)
    })
    await new YandexCloud('token').write('docs/events/a.json', new Blob(['{}']))
    expect(folderCreated).toBe(true)
    expect(uploaded).toEqual(['/put/1'])
  })

  it('устаревший вход — понятная ошибка с просьбой войти снова', async () => {
    mockFetch(() => json({ error: 'UnauthorizedError', message: 'Не авторизован.' }, 401))
    await expect(new YandexCloud('token').listChanges('docs/events')).rejects.toBeInstanceOf(YandexAuthError)
  })

  it('повторяет запрос, если ресурс занят другой операцией Диска (423), но не повторяет отказ в доступе', async () => {
    let calls = 0
    const [value, attempts] = await withRetry(
      async () => {
        if (++calls < 3) throw new YandexDiskError(423, 'Ресурс заблокирован. Возможно, над ним выполняется другая операция.')
        return 'ok'
      },
      { attempts: 5, delaysMs: [0] },
    )
    expect([value, attempts]).toEqual(['ok', 3])

    let denied = 0
    await expect(
      withRetry(
        async () => {
          denied++
          throw new YandexDiskError(403, 'Нет доступа')
        },
        { attempts: 5, delaysMs: [0] },
      ),
    ).rejects.toThrow('Нет доступа')
    expect(denied).toBe(1)
  })
})
