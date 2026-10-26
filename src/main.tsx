import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ensureSeeded } from './app/seed'
import { startAutoBackup } from './backup/autoBackup'
import { startWeather } from './weather/service'
import { startSync } from './sync/runner'
import { consumeOAuthRedirect } from './cloud/yandexAuth'
import { saveResult } from './lab/results'
import { registerServiceWorker } from './sw/register'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './index.css'

const oauth = consumeOAuthRedirect()
if (oauth.kind === 'token') {
  const state = { session: 'проверено', local: 'проверено через общее хранилище', missing: 'не проверено' }[oauth.stateChecked]
  saveResult('yandex-auth', oauth.stateChecked === 'session' ? 'ok' : 'warn', `Вход через Яндекс ID выполнен, состояние запроса: ${state}`)
} else if (oauth.kind === 'error') {
  saveResult('yandex-auth', 'fail', `Вход через Яндекс ID не выполнен: ${oauth.message}`)
}

/** version.json не кэшируется офлайн-режимом, поэтому его недоступность означает запуск без сети. */
async function detectOfflineLaunch(): Promise<void> {
  const at = new Date().toLocaleString('ru-RU')
  if (!navigator.onLine) return saveResult('offline', 'ok', `Приложение открылось без сети ${at} (сеть выключена)`)
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(String(response.status))
  } catch {
    saveResult('offline', 'ok', `Приложение открылось без связи с сервером ${at}`)
  }
}

void detectOfflineLaunch()
void ensureSeeded()
void startAutoBackup()
startWeather()
void startSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Файл, брошенный мимо записи дневника, не должен открываться в окне вместо приложения.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  })
}

window.addEventListener('load', () => registerServiceWorker())
