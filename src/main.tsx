import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { consumeOAuthRedirect } from './cloud/yandexAuth'
import { saveResult } from './lab/results'
import { registerServiceWorker } from './sw/register'
import './index.css'

const oauth = consumeOAuthRedirect()
if (oauth.kind === 'token') {
  const state = { session: 'проверено', local: 'проверено через общее хранилище', missing: 'не проверено' }[oauth.stateChecked]
  saveResult('yandex-auth', oauth.stateChecked === 'session' ? 'ok' : 'warn', `Вход через Яндекс ID выполнен, состояние запроса: ${state}`)
} else if (oauth.kind === 'error') {
  saveResult('yandex-auth', 'fail', `Вход через Яндекс ID не выполнен: ${oauth.message}`)
}

if (!navigator.onLine) {
  saveResult('offline', 'ok', `Приложение открылось без сети ${new Date().toLocaleString('ru-RU')}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

window.addEventListener('load', () => registerServiceWorker())
