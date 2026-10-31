import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ensureSeeded } from '../app/seed'
import { restoreBackup, type RestoreResult } from '../backup/backup'
import { setSetting, type AppSettings, type PhotoPosition, type ThemeSetting } from '../app/store'
import { versionLabel } from '../app/version'
import { locationText, parseLocation, roundLocation, type PlotLocation } from '../domain/location'
import { db } from '../storage/db'
import { Screen } from '../ui/Screen'
import { ActionButton } from '../ui/Section'
import { errorText } from '../lib/format'
import { updateApp } from '../sw/register'
import { fillMissingWeather, missingWeatherCount } from '../weather/service'

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

const PHOTO_POSITIONS: { value: PhotoPosition; label: string }[] = [
  { value: 'right', label: 'Справа от текста' },
  { value: 'left', label: 'Слева от текста' },
  { value: 'below', label: 'Под текстом' },
]

const SCALES = [
  { value: 1, label: 'Обычный' },
  { value: 1.15, label: 'Крупный' },
  { value: 1.3, label: 'Очень крупный' },
]

export function SettingsScreen({ settings }: { settings: AppSettings }) {
  const [name, setName] = useState(settings.authorName)
  return (
    <Screen title="Настройки" help="settings" back="/more" tab="/more">
      <section className="card">
        <h2>Учётная запись</h2>
        <label className="field">
          Ваше имя (подпись записей)
          <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void setSetting('authorName', name.trim())} />
        </label>
      </section>
      <PlotSection settings={settings} />
      <section className="card">
        <h2>Внешний вид</h2>
        <fieldset className="choice">
          <legend>Тема</legend>
          {THEMES.map((theme) => (
            <label key={theme.value}>
              <input type="radio" name="theme" checked={settings.theme === theme.value} onChange={() => void setSetting('theme', theme.value)} />
              {theme.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice">
          <legend>Размер текста</legend>
          {SCALES.map((scale) => (
            <label key={scale.value}>
              <input type="radio" name="scale" checked={settings.textScale === scale.value} onChange={() => void setSetting('textScale', scale.value)} />
              {scale.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice">
          <legend>Фото в записях дневника</legend>
          {PHOTO_POSITIONS.map((position) => (
            <label key={position.value}>
              <input type="radio" name="photos" checked={settings.photoPosition === position.value} onChange={() => void setSetting('photoPosition', position.value)} />
              {position.label}
            </label>
          ))}
        </fieldset>
      </section>
      <section className="card">
        <h2>Справочники</h2>
        <p className="hint">Виды работ, единицы, объекты, группы растений, расходные материалы, народные приметы.</p>
        <a className="button secondary" href="#/dictionaries">
          Открыть справочники
        </a>
      </section>
      <section className="card">
        <h2>Дополнительно</h2>
        <p>{versionLabel()}</p>
        <UpdateCheck />
        <a className="button secondary" href="#/lab">
          Лаборатория проверок
        </a>
      </section>
    </Screen>
  )
}

function UpdateCheck() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  const check = async () => {
    setBusy(true)
    setFailed(false)
    setMessage('')
    try {
      const result = await updateApp()
      if (result === 'latest') setMessage('Установлена последняя версия.')
      else setMessage('Найдена новая версия. Обновляю…')
    } catch (caught) {
      setFailed(true)
      setMessage(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => void check()}>
          {busy ? 'Проверяю…' : 'Проверить обновление'}
        </button>
      </div>
      {message && <p className={failed ? 'error' : 'hint'}>{message}</p>}
    </>
  )
}

function PlotSection({ settings }: { settings: AppSettings }) {
  const [address, setAddress] = useState(settings.plotAddress)
  const [coordinates, setCoordinates] = useState(settings.plotLocation ? locationText(settings.plotLocation) : '')
  const [message, setMessage] = useState('')

  const saveLocation = (location: PlotLocation) => {
    setCoordinates(locationText(location))
    setMessage('')
    void setSetting('plotLocation', location)
  }

  const saveCoordinates = () => {
    if (!coordinates.trim()) {
      setMessage('')
      void setSetting('plotLocation', null)
      return
    }
    const location = parseLocation(coordinates)
    if (location) saveLocation(location)
    else setMessage('Не удалось разобрать координаты. Пример: 55.75, 37.62')
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage('Это устройство не умеет определять место.')
      return
    }
    setMessage('Определяю место…')
    navigator.geolocation.getCurrentPosition(
      (position) => saveLocation(roundLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude })),
      () => setMessage('Не удалось определить место. Разрешите доступ к геопозиции или введите координаты вручную.'),
      { enableHighAccuracy: false, timeout: 15000 },
    )
  }

  return (
    <section className="card">
      <h2>Участок</h2>
      <label className="field">
        Адрес дачи
        <textarea
          rows={2}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            void setSetting('plotAddress', event.target.value.trim())
          }}
        />
      </label>
      <label className="field">
        Координаты для погоды
        <input value={coordinates} inputMode="decimal" placeholder="55.75, 37.62" onChange={(event) => setCoordinates(event.target.value)} onBlur={saveCoordinates} />
      </label>
      <div className="actions">
        <button type="button" className="button secondary" onClick={locate}>
          Определить по месту
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
      <p className="hint">
        Адрес и координаты хранятся только на ваших устройствах и в ваших резервных копиях — в коде приложения и на GitHub их нет. «Определить по месту» нажимайте, находясь на участке.
        Для погоды сервису Open-Meteo передаются только округлённые координаты.
      </p>
      {settings.plotLocation && <MissingWeather />}
    </section>
  )
}

/** Погода для старых записей (импорт из Evernote, записи без связи): вручную, на одном устройстве. */
function MissingWeather() {
  const count = useLiveQuery(() => missingWeatherCount(), [])
  const [message, setMessage] = useState('')
  if (!count && !message) return null
  return (
    <div className="missing-weather">
      {!!count && (
        <>
          <p className="hint">
            Записей без погоды: {count}. Погода для них берётся из архива Open-Meteo (модельная оценка, а не измерение на участке) — одним запросом на год.
            Запускайте на одном устройстве: остальные получат записи с погодой через облако.
          </p>
          <ActionButton
            secondary
            onRun={async () => {
              if (!confirm(`Подставить погоду в ${count} записей? Записи изменятся и уйдут в облако.`)) return
              const result = await fillMissingWeather(setMessage)
              setMessage(`Погода подставлена в записей: ${result.filled}${result.skipped ? `; без данных в архиве: ${result.skipped}` : ''}.`)
            }}
          >
            Подставить погоду в старые записи
          </ActionButton>
        </>
      )}
      {message && <p className="notice">{message}</p>}
    </div>
  )
}

export function WelcomeScreen() {
  const [name, setName] = useState('')
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>DachaBook</h1>
        <p>Дневник дачных работ и наблюдений</p>
      </header>
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) void setSetting('authorName', name.trim()).then(() => ensureSeeded())
        }}
      >
        <h2>Как вас зовут?</h2>
        <p className="hint">Имя подписывает записи: в общем дневнике будет видно, кто что добавил и изменил.</p>
        <label className="field">
          Имя
          <input value={name} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" className="button" disabled={!name.trim()}>
            Начать
          </button>
        </div>
      </form>
      <RestoreOnWelcome />
    </main>
  )
}

/** Новый браузер или ярлык открывает DachaBook с пустым хранилищем — отсюда данные можно вернуть из резервной копии. */
function RestoreOnWelcome() {
  const events = useLiveQuery(() => db.events.count(), [])
  const [restored, setRestored] = useState<RestoreResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restore = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      setRestored(await restoreBackup(db, await file.arrayBuffer()))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Уже пользовались DachaBook?</h2>
      <p className="hint">
        Данные хранятся в том браузере, где вы вели дневник. Safari, Chrome и приложение, добавленное в Dock или на экран «Домой», хранят данные отдельно
        друг от друга, поэтому в новом месте DachaBook открывается пустым. Откройте его там, где вели записи, или восстановите данные из резервной копии —
        файла dachabook-backup-….zip.
      </p>
      {!!events && <p className="small">В этом браузере уже есть записей дневника: {events}. Введите имя, чтобы продолжить.</p>}
      <div className="actions">
        <label className={`button secondary${busy ? ' disabled' : ''}`}>
          {busy ? 'Восстановление…' : 'Восстановить из резервной копии'}
          <input type="file" accept=".zip,application/zip" hidden disabled={busy} onChange={(event) => void restore(event.target.files?.[0])} />
        </label>
      </div>
      {restored && (
        <div className="notice">
          <p>
            Восстановлено: добавлено {restored.added}, без изменений {restored.same}, файлов {restored.files}. Введите имя выше и нажмите «Начать».
          </p>
          {restored.corrupted.length > 0 && <p className="error">Повреждены и не загружены: {restored.corrupted.join('; ')}</p>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
