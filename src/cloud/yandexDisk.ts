import { YANDEX_DOWNLOAD_PROXY } from './yandexConfig'

const API = 'https://cloud-api.yandex.net/v1/disk'
const AUTH = 'https://oauth.yandex.ru/authorize'

export interface YandexToken {
  accessToken: string
  expiresAt?: string
}

export class YandexDiskError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'YandexDiskError'
    this.status = status
    this.code = code
  }
}

/** Браузер не сообщает причину сетевой ошибки («Load failed»), поэтому указываем шаг и сервер. */
async function send(url: string, init: RequestInit, purpose: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const host = new URL(url).host
    throw new YandexDiskError(0, `${purpose}: нет ответа от ${host} — браузер заблокировал запрос (CORS) или пропала сеть`, 'network')
  }
}

export interface RetryOptions {
  attempts?: number
  delaysMs?: number[]
  onFailure?: (attempt: number, elapsedMs: number, error: unknown) => void
}

/**
 * Повторяет действие при сетевом сбое, 429 и ошибках сервера 5xx.
 * Пауза перед повтором нужна, чтобы сервер успел отпустить оборванную передачу.
 */
export async function withRetry<T>(action: () => Promise<T>, options: RetryOptions = {}): Promise<[T, number]> {
  const attempts = options.attempts ?? 3
  const delays = options.delaysMs ?? [3000, 10000]
  for (let attempt = 1; ; attempt++) {
    const start = performance.now()
    try {
      return [await action(), attempt]
    } catch (error) {
      options.onFailure?.(attempt, performance.now() - start, error)
      const retriable = error instanceof YandexDiskError && (error.status === 0 || error.status === 429 || error.status >= 500)
      if (!retriable || attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, delays[Math.min(attempt - 1, delays.length - 1)]))
    }
  }
}

export function redirectUri(): string {
  return `${location.origin}${location.pathname}`
}

export function authorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
    redirect_uri: redirectUri(),
    state,
  })
  return `${AUTH}?${params}`
}

/** Разбирает ответ OAuth из адреса после возврата со страницы Яндекса. */
export function readTokenFromHash(hash: string): (YandexToken & { state?: string }) | { error: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const error = params.get('error')
  if (error) return { error: params.get('error_description') ?? error }
  const accessToken = params.get('access_token')
  if (!accessToken) return null
  const expiresIn = Number(params.get('expires_in'))
  return {
    accessToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    state: params.get('state') ?? undefined,
  }
}

export interface DiskInfo {
  total_space: number
  used_space: number
  user?: { login?: string; display_name?: string; uid?: string }
}

export interface ResourceMeta {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  md5?: string
  sha256?: string
  modified?: string
}

export class YandexDisk {
  private token: string

  constructor(token: string) {
    this.token = token
  }

  private async request<T>(method: string, path: string, params: Record<string, string> = {}): Promise<T> {
    const response = await send(
      `${API}${path}?${new URLSearchParams(params)}`,
      { method, headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' } },
      `Запрос ${method} ${path || '/'} к API Диска`,
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; description?: string; error?: string }
      throw new YandexDiskError(response.status, body.message ?? body.description ?? response.statusText, body.error)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  info(): Promise<DiskInfo> {
    return this.request('GET', '')
  }

  meta(path: string): Promise<ResourceMeta> {
    return this.request('GET', '/resources', { path, fields: 'name,path,type,size,md5,sha256,modified' })
  }

  async list(path: string): Promise<ResourceMeta[]> {
    const result = await this.request<{ _embedded?: { items: ResourceMeta[] } }>('GET', '/resources', {
      path,
      limit: '1000',
      fields: '_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.md5,_embedded.items.sha256',
    })
    return result._embedded?.items ?? []
  }

  /** Создаёт папку и все недостающие родительские папки. */
  async ensureFolder(path: string): Promise<void> {
    const parts = path.replace(/^disk:\//, '').split('/').filter(Boolean)
    let current = 'disk:'
    for (const part of parts) {
      current += `/${part}`
      try {
        await this.request('PUT', '/resources', { path: current })
      } catch (error) {
        if (!(error instanceof YandexDiskError && error.status === 409)) throw error
      }
    }
  }

  async upload(path: string, data: Blob, signal?: AbortSignal): Promise<void> {
    const target = await this.request<{ href: string; method: string }>('GET', '/resources/upload', { path, overwrite: 'true' })
    const response = await send(target.href, { method: target.method || 'PUT', body: data, signal }, 'Загрузка файла на сервер Диска')
    if (!response.ok) throw new YandexDiskError(response.status, `Загрузка не принята: ${response.statusText}`)
  }

  /** Загрузка с повторами; каждая попытка получает новую ссылку загрузки. */
  async uploadWithRetry(path: string, data: Blob, options: RetryOptions = {}): Promise<number> {
    const [, attempts] = await withRetry(() => this.upload(path, data), options)
    return attempts
  }

  /** Скачивание с повторами; каждая попытка получает новую ссылку скачивания. */
  async downloadWithRetry(path: string, options: RetryOptions = {}): Promise<[Blob, number]> {
    return withRetry(() => this.download(path), options)
  }

  async download(path: string, signal?: AbortSignal): Promise<Blob> {
    const target = await this.request<{ href: string }>('GET', '/resources/download', { path })
    const url = `${YANDEX_DOWNLOAD_PROXY}?${new URLSearchParams({ url: target.href })}`
    const response = await send(url, { signal }, 'Скачивание файла через посредника')
    if (response.status === 404) {
      throw new YandexDiskError(404, 'Посредник скачивания не установлен: в Supabase нет функции yandex-download')
    }
    if (!response.ok) throw new YandexDiskError(response.status, `Скачивание не удалось: ${response.status} ${await response.text()}`)
    return response.blob()
  }

  async remove(path: string): Promise<void> {
    await this.request('DELETE', '/resources', { path, permanently: 'true' })
  }
}
