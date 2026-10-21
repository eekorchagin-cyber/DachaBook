import { useState } from 'react'
import { setSetting, type AppSettings, type PhotoPosition, type ThemeSetting } from '../app/store'
import { versionLabel } from '../app/version'
import { Screen } from '../ui/Screen'

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
        <h2>Дополнительно</h2>
        <p>{versionLabel()}</p>
        <a className="button secondary" href="#/lab">
          Лаборатория проверок
        </a>
      </section>
    </Screen>
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
          if (name.trim()) void setSetting('authorName', name.trim())
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
    </main>
  )
}
