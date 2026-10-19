import { useState } from 'react'
import { forgetToken, getClientId, getToken, setClientId, startLogin } from '../../cloud/yandexAuth'
import { redirectUri, YandexDisk } from '../../cloud/yandexDisk'
import { errorText } from '../../lib/format'
import { labDb } from '../labDb'
import { saveResult, type LabResult } from '../results'
import { runYandexSuite } from '../yandexTests'
import { ActionButton, LogView, Section } from '../../ui/Section'

export function YandexSection({ results }: { results: Record<string, LabResult> }) {
  const [clientId, setClientIdState] = useState(getClientId())
  const [token, setToken] = useState(getToken())
  const [log, setLog] = useState<string[]>([])

  return (
    <Section
      title="Яндекс Диск"
      result={results.yandex ?? results['yandex-auth']}
      hint="Проверяются вход через Яндекс ID, загрузка файлов из браузера, скачивание через посредника Supabase, сверка контрольных сумм и повтор после оборванной загрузки. Тестовая папка DachaBook/lab в конце удаляется."
    >
      <dl className="facts">
        <dt>Адрес возврата</dt>
        <dd className="small">{redirectUri()}</dd>
        <dt>Вход</dt>
        <dd>{token ? `выполнен${token.expiresAt ? `, действует до ${new Date(token.expiresAt).toLocaleDateString('ru-RU')}` : ''}` : 'не выполнен'}</dd>
      </dl>
      {!getClientId() && (
        <label className="field">
          ClientID приложения Яндекс ID
          <input value={clientId} onChange={(event) => setClientIdState(event.target.value)} placeholder="например, 0123456789abcdef…" />
        </label>
      )}
      <div className="actions">
        {!token && (
          <ActionButton
            disabled={!clientId.trim()}
            onRun={async () => {
              setClientId(clientId)
              startLogin(clientId.trim())
            }}
          >
            Войти через Яндекс
          </ActionButton>
        )}
        {token && (
          <ActionButton
            onRun={async () => {
              setLog([])
              const lines: string[] = []
              const add = (line: string) => {
                lines.push(line)
                setLog([...lines])
              }
              const photo = (await labDb.blobs.where('kind').equals('photo-original').sortBy('createdAt')).at(-1)?.data
              try {
                await runYandexSuite(new YandexDisk(token.accessToken), add, photo)
                saveResult('yandex', 'ok', lines.join('; '))
              } catch (error) {
                add(`Сбой: ${errorText(error)}`)
                saveResult('yandex', 'fail', lines.join('; '))
                throw error
              }
            }}
          >
            Проверить Яндекс Диск
          </ActionButton>
        )}
        {token && (
          <ActionButton
            secondary
            onRun={async () => {
              forgetToken()
              setToken(null)
            }}
          >
            Выйти
          </ActionButton>
        )}
      </div>
      <LogView lines={log} />
    </Section>
  )
}
