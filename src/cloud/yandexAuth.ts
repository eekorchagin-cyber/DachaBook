import { YANDEX_CLIENT_ID } from './yandexConfig'
import { authorizeUrl, readTokenFromHash, type YandexToken } from './yandexDisk'

const TOKEN_KEY = 'dachabook-yandex-token'
const CLIENT_KEY = 'dachabook-yandex-client-id'
const STATE_KEY = 'dachabook-yandex-state'
const RETURN_KEY = 'dachabook-yandex-return'

export function getClientId(): string {
  return YANDEX_CLIENT_ID || localStorage.getItem(CLIENT_KEY) || ''
}

export function setClientId(clientId: string): void {
  localStorage.setItem(CLIENT_KEY, clientId.trim())
}

export function getToken(): YandexToken | null {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as YandexToken | null
    if (token?.expiresAt && Date.parse(token.expiresAt) < Date.now()) return null
    return token
  } catch {
    return null
  }
}

export function forgetToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** returnTo — экран, на который вернуться после входа (лаборатория или «Облако»). */
export function startLogin(clientId: string, returnTo = '#/lab'): void {
  localStorage.setItem(RETURN_KEY, returnTo)
  const state = crypto.randomUUID()
  sessionStorage.setItem(STATE_KEY, state)
  localStorage.setItem(STATE_KEY, state)
  location.assign(authorizeUrl(clientId, state))
}

export type OAuthOutcome =
  | { kind: 'none' }
  | { kind: 'token'; stateChecked: 'session' | 'local' | 'missing' }
  | { kind: 'error'; message: string }

/**
 * Забирает токен из адреса после возврата с oauth.yandex.ru.
 * Состояние запроса ищется и в sessionStorage, и в localStorage: на iPhone вход
 * из приложения на экране «Домой» может вернуться в другой контекст.
 */
export function consumeOAuthRedirect(): OAuthOutcome {
  const parsed = readTokenFromHash(location.hash)
  if (!parsed) return { kind: 'none' }
  history.replaceState(null, '', `${location.pathname}${location.search}${localStorage.getItem(RETURN_KEY) ?? '#/lab'}`)
  localStorage.removeItem(RETURN_KEY)
  if ('error' in parsed) return { kind: 'error', message: parsed.error }

  const sessionState = sessionStorage.getItem(STATE_KEY)
  const localState = localStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  localStorage.removeItem(STATE_KEY)
  const stateChecked = parsed.state && parsed.state === sessionState ? 'session' : parsed.state && parsed.state === localState ? 'local' : 'missing'
  if (stateChecked === 'missing' && (sessionState || localState)) {
    return { kind: 'error', message: 'Ответ Яндекса не соответствует запросу входа' }
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: parsed.accessToken, expiresAt: parsed.expiresAt }))
  return { kind: 'token', stateChecked }
}
