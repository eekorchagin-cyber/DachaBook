import { useEffect, useState } from 'react'
import { formatBytes } from '../../lib/format'
import { readEnvironment, type Environment } from '../environment'
import { saveResult, type LabResult } from '../results'
import { ActionButton, Section } from '../../ui/Section'

export function EnvSection({ result }: { result?: LabResult }) {
  const [env, setEnv] = useState<Environment | null>(null)

  const apply = (next: Environment) => {
    setEnv(next)
    const problems: string[] = []
    if (!next.secureContext) problems.push('нет защищённого соединения')
    if (!next.standalone) problems.push('открыто не с экрана «Домой»')
    if (next.persisted === false) problems.push('постоянное хранение не включено')
    saveResult(
      'env',
      problems.length ? 'warn' : 'ok',
      `${next.standalone ? 'Ярлык «Домой»' : 'Вкладка браузера'}; хранилище ${formatBytes(next.storageUsage ?? 0)} из ${formatBytes(next.storageQuota ?? 0)}; постоянное хранение: ${next.persisted ? 'да' : 'нет'}${problems.length ? `. Замечания: ${problems.join(', ')}` : ''}`,
    )
  }

  const refresh = async () => apply(await readEnvironment())

  useEffect(() => {
    void readEnvironment().then(apply)
  }, [])

  return (
    <Section
      title="Устройство и браузер"
      result={result}
      hint="На iPhone проверки нужно проводить в приложении, открытом с ярлыка на экране «Домой», а не во вкладке Safari."
    >
      {env && (
        <dl className="facts">
          <dt>Версия</dt>
          <dd>{env.version}</dd>
          <dt>Открыто</dt>
          <dd>{env.standalone ? 'с экрана «Домой»' : 'во вкладке браузера'}</dd>
          <dt>Хранилище</dt>
          <dd>
            занято {formatBytes(env.storageUsage ?? 0)}, доступно до {formatBytes(env.storageQuota ?? 0)}
          </dd>
          <dt>Постоянное хранение</dt>
          <dd>{env.persisted === undefined ? 'не поддерживается' : env.persisted ? 'включено' : 'не включено'}</dd>
          <dt>Экран</dt>
          <dd>{env.screen}</dd>
          <dt>Браузер</dt>
          <dd className="small">{env.userAgent}</dd>
        </dl>
      )}
      <div className="actions">
        <ActionButton
          onRun={async () => {
            if (!navigator.storage?.persist) throw new Error('Браузер не поддерживает запрос постоянного хранения')
            const granted = await navigator.storage.persist()
            await refresh()
            if (!granted) throw new Error('Браузер отказал в постоянном хранении')
          }}
        >
          Включить постоянное хранение
        </ActionButton>
        <ActionButton secondary onRun={refresh}>
          Обновить
        </ActionButton>
      </div>
    </Section>
  )
}
