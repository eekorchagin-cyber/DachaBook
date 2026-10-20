import { Component, type ReactNode } from 'react'
import { versionLabel } from '../app/version'

declare global {
  interface Window {
    __dachabookReset?: () => void
  }
}

/** Вместо пустого экрана показывает текст ошибки и кнопку сброса офлайн-копии. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="recovery">
        <h1>В DachaBook произошла ошибка</h1>
        <p>Записи дневника не пострадали. Попробуйте перезагрузить приложение начисто. Если ошибка повторится, пришлите текст ниже.</p>
        <p>
          <button type="button" className="button" onClick={() => (window.__dachabookReset ? window.__dachabookReset() : location.reload())}>
            Перезагрузить начисто
          </button>
        </p>
        <pre>{`${versionLabel()}\n${location.hash}\n${error.name}: ${error.message}\n${error.stack ?? ''}`}</pre>
      </div>
    )
  }
}
