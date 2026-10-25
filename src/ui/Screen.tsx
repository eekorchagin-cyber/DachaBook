import type { ReactNode } from 'react'
import { HelpButton } from './HelpButton'
import { UpdateBanner } from './UpdateBanner'

const TABS = [
  { path: '/', label: 'Главная', icon: '⌂' },
  { path: '/diary', label: 'Дневник', icon: '✎' },
  { path: '/objects', label: 'Объекты', icon: '❦' },
  { path: '/library', label: 'Статьи', icon: '❑' },
  { path: '/more', label: 'Ещё', icon: '⋯' },
]

/** back — куда ведёт стрелка «назад»; onBack — вместо перехода закрыть открытую карточку и вернуться к списку. */
export function Screen(props: { title: string; help?: string; back?: string; onBack?: () => void; actions?: ReactNode; children: ReactNode; tab: string }) {
  return (
    <div className="app">
      <header className="topbar">
        {props.onBack ? (
          <button type="button" className="icon-button" aria-label="Назад" onClick={props.onBack}>
            ←
          </button>
        ) : props.back ? (
          <a className="icon-button" href={`#${props.back}`} aria-label="Назад">
            ←
          </a>
        ) : (
          <span className="topbar-spacer" />
        )}
        <h1>{props.title}</h1>
        <div className="topbar-actions">
          {props.actions}
          {props.help && <HelpButton topic={props.help} />}
        </div>
      </header>
      <UpdateBanner />
      <main className="content">{props.children}</main>
      <nav className="tabbar" aria-label="Разделы">
        {TABS.map((tab) => (
          <a key={tab.path} href={`#${tab.path}`} className={tab.path === props.tab ? 'tab active' : 'tab'}>
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </nav>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
