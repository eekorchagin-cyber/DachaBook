import { useEffect, useState } from 'react'
import { LabScreen } from './lab/LabScreen'

function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash.replace(/^#/, '') || '/')
  useEffect(() => {
    const update = () => setRoute(location.hash.replace(/^#/, '') || '/')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

function HomeScreen() {
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>DachaBook</h1>
        <p>Дневник дачных работ и наблюдений</p>
      </header>
      <section className="card">
        <h2>Этап 1: технический прототип</h2>
        <p>
          Сейчас проверяется, как приложение хранит данные, работает без интернета, обрабатывает фотографии, обменивается файлами с
          Яндекс Диском и разбирает файлы Evernote. Дневник появится на этапе 2.
        </p>
        <a className="button" href="#/lab">
          Открыть лабораторию проверок
        </a>
      </section>
      <p className="version">Версия {__APP_VERSION__}</p>
    </main>
  )
}

export default function App() {
  const route = useHashRoute()
  return route.startsWith('/lab') ? <LabScreen /> : <HomeScreen />
}
