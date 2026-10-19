import { useEffect, useState } from 'react'
import { cachedFileCount, useServiceWorkerState, type SwState } from '../../sw/register'
import { saveResult, type LabResult } from '../results'
import { Section } from '../../ui/Section'

function describe(state: SwState): string {
  switch (state.kind) {
    case 'unsupported':
      return 'браузер не поддерживает работу без сети'
    case 'dev':
      return 'режим разработки: офлайн-кэш отключён'
    case 'registering':
      return 'подготовка офлайн-режима…'
    case 'ready':
      return state.controlled ? 'офлайн-режим готов и управляет страницей' : 'офлайн-режим готов, начнёт работать со следующего открытия'
    case 'timeout':
      return 'регистрация офлайн-режима не завершилась за 15 секунд (так бывает при включённом VPN)'
    case 'error':
      return `ошибка офлайн-режима: ${state.message}`
  }
}

export function OfflineSection({ results }: { results: Record<string, LabResult> }) {
  const sw = useServiceWorkerState()
  const [cached, setCached] = useState(0)

  useEffect(() => {
    void cachedFileCount().then(setCached)
    if (sw.kind === 'ready' || sw.kind === 'timeout' || sw.kind === 'error' || sw.kind === 'unsupported') {
      saveResult('sw', sw.kind === 'ready' ? 'ok' : 'fail', `Офлайн-режим: ${describe(sw)}`)
    }
  }, [sw])

  return (
    <Section
      title="Работа без интернета"
      result={results.offline ?? results.sw}
      hint="Проверка: дождитесь «офлайн-режим готов», закройте приложение, включите авиарежим и снова откройте его с ярлыка. Если приложение открылось — проверка пройдена автоматически."
    >
      <dl className="facts">
        <dt>Состояние</dt>
        <dd>{describe(sw)}</dd>
        <dt>Файлов в офлайн-кэше</dt>
        <dd>{cached}</dd>
        <dt>Сеть сейчас</dt>
        <dd>{navigator.onLine ? 'есть' : 'нет'}</dd>
      </dl>
    </Section>
  )
}
