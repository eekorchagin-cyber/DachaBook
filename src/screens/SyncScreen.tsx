import { useEffect, useState } from 'react'
import { getClientId, getToken, startLogin } from '../cloud/yandexAuth'
import { YandexDisk } from '../cloud/yandexDisk'
import { errorText } from '../lib/format'
import { db } from '../storage/db'
import { localDataCount, MANIFEST, type DiaryManifest } from '../sync/engine'
import { disableSync, enableSync, syncNow, syncSummary, syncTime as time, useSyncStatus } from '../sync/runner'
import { YandexCloud } from '../sync/yandexCloud'
import { Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'

interface Inspection {
  login?: string
  cloudDiary: DiaryManifest | null
  localCount: number
}

function FirstConnect({ token }: { token: string }) {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<'merge' | 'replace'>('merge')

  useEffect(() => {
    void (async () => {
      try {
        const info = await new YandexDisk(token).info()
        const manifest = await new YandexCloud(token).read(MANIFEST)
        setInspection({
          login: info.user?.login,
          cloudDiary: manifest ? (JSON.parse(await manifest.text()) as DiaryManifest) : null,
          localCount: await localDataCount(db),
        })
      } catch (caught) {
        setError(errorText(caught))
      }
    })()
  }, [token])

  if (error) return <p className="error">Не удалось проверить Яндекс Диск: {error}</p>
  if (!inspection) return <p className="hint">Проверяю Яндекс Диск…</p>
  const { cloudDiary, localCount, login } = inspection
  return (
    <>
      <p>
        Вход выполнен{login ? `: ${login}` : ''}. Дневник будет храниться в папке <strong>DachaBook/diary</strong> на вашем Яндекс Диске.
      </p>
      {!cloudDiary && <p className="hint">В облаке дневника ещё нет — дневник этого устройства будет отправлен туда. Первая отправка может занять несколько минут.</p>}
      {cloudDiary && localCount === 0 && <p className="hint">В облаке уже есть дневник — он будет загружен на это устройство.</p>}
      {cloudDiary && localCount > 0 && (
        <fieldset className="choice">
          <legend>В облаке уже есть дневник, а на этом устройстве — свои записи ({localCount})</legend>
          <label>
            <input type="radio" name="first" checked={choice === 'merge'} onChange={() => setChoice('merge')} />
            Объединить: записи устройства добавятся к дневнику в облаке
          </label>
          <label>
            <input type="radio" name="first" checked={choice === 'replace'} onChange={() => setChoice('replace')} />
            Взять из облака: записи устройства заменятся дневником из облака (сохранятся в снимке на устройстве)
          </label>
        </fieldset>
      )}
      <div className="actions">
        <ActionButton onRun={async () => void (await enableSync('yandex', cloudDiary && localCount > 0 ? choice : undefined))}>Подключить и синхронизировать</ActionButton>
      </div>
    </>
  )
}

export function SyncScreen() {
  const status = useSyncStatus()
  const token = getToken()
  const summary = syncSummary(status)
  const result = status.lastResult

  return (
    <Screen title="Облако" help="sync" back="/more" tab="/more">
      <section className="card">
        <h2>Яндекс Диск</h2>
        {status.connected ? (
          <>
            <p className={summary.warning ? 'error' : 'notice'}>{summary.text}</p>
            <p className="small">
              Последняя успешная синхронизация: {time(status.lastSuccessAt)}. Ожидает отправки: {status.pending}.
            </p>
            {result && !status.running && (
              <p className="small muted">
                В прошлый раз: получено {result.pulled}, отправлено {result.pushed}, файлов отправлено {result.uploadedFiles}, уменьшенных копий получено {result.thumbs}
                {result.bootstrapped ? ', дневник загружен снимком' : ''}.
              </p>
            )}
            {status.conflicts > 0 && (
              <a className="button" href="#/conflicts">
                Разобрать конфликты ({status.conflicts})
              </a>
            )}
            <div className="actions">
              {status.needsLogin ? (
                <button type="button" className="button" onClick={() => startLogin(getClientId(), '#/sync')}>
                  Войти в Яндекс снова
                </button>
              ) : (
                <ActionButton disabled={status.running} onRun={async () => void (await syncNow())}>
                  Синхронизировать сейчас
                </ActionButton>
              )}
              <ActionButton
                secondary
                onRun={async () => {
                  const warning =
                    status.pending > 0
                      ? `Отключить облако? ${status.pending} изменений ещё не отправлены — они останутся на этом устройстве и уйдут при следующем подключении.`
                      : 'Отключить облако? Данные на устройстве и в облаке сохранятся.'
                  if (confirm(warning)) await disableSync()
                }}
              >
                Отключить
              </ActionButton>
            </div>
            <p className="hint">
              Синхронизация идёт при открытии приложения, при возврате в него, через 20 секунд после изменений и каждые 5 минут. Без интернета изменения
              копятся и уйдут, когда появится сеть.
            </p>
          </>
        ) : token ? (
          <FirstConnect token={token.accessToken} />
        ) : (
          <>
            <p>
              Подключите Яндекс Диск, чтобы дневник был одинаковым на iPhone, Mac и Windows и хранился в облаке. Записи, фото и файлы лежат в папке
              DachaBook/diary на вашем Диске; пароль от Яндекса приложение не видит.
            </p>
            <div className="actions">
              <button type="button" className="button" onClick={() => startLogin(getClientId(), '#/sync')}>
                Войти в Яндекс и подключить
              </button>
            </div>
          </>
        )}
      </section>
      <section className="card">
        <h2>Другие облака</h2>
        <ul className="list">
          <li className="list-row">
            <span>
              <strong>Dropbox</strong> <span className="muted">— появится после проверки Яндекс Диска</span>
            </span>
          </li>
          <li className="list-row">
            <span>
              <strong>iCloud</strong> <span className="muted">— недоступен в веб-версии: браузер не имеет доступа к iCloud Drive на iPhone и Windows</span>
            </span>
          </li>
        </ul>
      </section>
    </Screen>
  )
}
