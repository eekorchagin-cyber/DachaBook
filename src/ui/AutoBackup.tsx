import { useLiveQuery } from 'dexie-react-hooks'
import {
  AUTO_BACKUP_FOLDER_KEY,
  AUTO_BACKUP_STATE_KEY,
  autoBackupSupported,
  chooseBackupFolder,
  disableAutoBackup,
  grantFolderAccess,
  runAutoBackup,
  type AutoBackupState,
} from '../backup/autoBackup'
import { formatBytes } from '../lib/format'
import { db } from '../storage/db'
import { ActionButton } from './Section'

function useAutoBackup(): { folder?: string; state: AutoBackupState } | undefined {
  return useLiveQuery(async () => {
    const folder = (await db.settings.get(AUTO_BACKUP_FOLDER_KEY))?.value as { name: string } | undefined
    const state = ((await db.settings.get(AUTO_BACKUP_STATE_KEY))?.value as AutoBackupState | undefined) ?? {}
    return { folder: folder?.name, state }
  }, [])
}

export function AutoBackupSection() {
  const auto = useAutoBackup()
  if (!autoBackupSupported()) {
    return (
      <section className="card">
        <h2>Автокопия в папку</h2>
        <p className="hint">
          Автокопия работает в Chrome и Edge на компьютере. В этом браузере сохраняйте копию кнопкой «Создать резервную копию» после важных изменений.
        </p>
      </section>
    )
  }
  if (!auto) return null
  const { folder, state } = auto
  return (
    <section className="card">
      <h2>Автокопия в папку</h2>
      <p className="hint">
        Выберите папку один раз — дальше приложение само сохраняет туда полную копию через минуту после изменений (не чаще раза в 10 минут). Один файл
        на день, хранятся копии за 7 последних дней. Удобно выбрать папку Яндекс Диска или iCloud Drive на компьютере — копии попадут и в облако.
      </p>
      {folder ? (
        <>
          <p>
            Папка: <strong>{folder}</strong>
          </p>
          <p className="small">
            Последняя автокопия:{' '}
            {state.at ? `${new Date(state.at).toLocaleString('ru-RU')} — ${state.file}${state.size ? `, ${formatBytes(state.size)}` : ''}` : 'ещё не создавалась'}
          </p>
          {state.needsPermission && <p className="error">Браузер просит заново разрешить запись в папку — без этого автокопия приостановлена.</p>}
          {state.error && <p className="error">Последняя попытка не удалась: {state.error}</p>}
          <div className="actions">
            {state.needsPermission ? (
              <ActionButton onRun={grantFolderAccess}>Разрешить доступ к папке</ActionButton>
            ) : (
              <ActionButton onRun={runAutoBackup}>Сделать копию сейчас</ActionButton>
            )}
            <ActionButton secondary onRun={chooseBackupFolder}>
              Сменить папку
            </ActionButton>
            <ActionButton
              secondary
              onRun={async () => {
                if (confirm('Отключить автокопию? Уже сохранённые файлы останутся в папке.')) await disableAutoBackup()
              }}
            >
              Отключить
            </ActionButton>
          </div>
          <p className="hint">Если Chrome спросит, как долго разрешать доступ, выберите «Разрешать при каждом посещении» — тогда копии будут делаться без вопросов.</p>
        </>
      ) : (
        <div className="actions">
          <ActionButton onRun={chooseBackupFolder}>Выбрать папку для автокопий</ActionButton>
        </div>
      )}
    </section>
  )
}

/** Предупреждение на главном экране, если автокопия включена, но остановилась. */
export function AutoBackupWarning() {
  const auto = useAutoBackup()
  if (!auto?.folder || (!auto.state.needsPermission && !auto.state.error)) return null
  return (
    <div className="notice warning">
      <p>{auto.state.needsPermission ? 'Автокопия ждёт разрешения на запись в папку.' : `Автокопия не сохранилась: ${auto.state.error}`}</p>
      <div className="actions">
        {auto.state.needsPermission ? <ActionButton onRun={grantFolderAccess}>Разрешить</ActionButton> : <ActionButton onRun={runAutoBackup}>Повторить</ActionButton>}
        <a className="button secondary" href="#/backup">
          Подробнее
        </a>
      </div>
    </div>
  )
}
