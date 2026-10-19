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
    const response = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      method,
      headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' },
    })
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
    const response = await fetch(target.href, { method: target.method || 'PUT', body: data, signal })
    if (!response.ok) throw new YandexDiskError(response.status, `Загрузка не принята: ${response.statusText}`)
  }

  async download(path: string, signal?: AbortSignal): Promise<Blob> {
    const target = await this.request<{ href: string }>('GET', '/resources/download', { path })
    const response = await fetch(target.href, { signal })
    if (!response.ok) throw new YandexDiskError(response.status, `Скачивание не удалось: ${response.statusText}`)
    return response.blob()
  }

  async remove(path: string): Promise<void> {
    await this.request('DELETE', '/resources', { path, permanently: 'true' })
  }
}
