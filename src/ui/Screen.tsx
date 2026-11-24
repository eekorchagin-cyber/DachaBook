import { useEffect, useRef, type ReactNode } from 'react'
import { goBack, useBackTarget } from '../app/router'
import { WorkBadge } from '../plan/WorkBadge'
import { HelpButton } from './HelpButton'
import { UpdateBanner } from './UpdateBanner'

const TABS = [
  { path: '/', label: 'Главная', icon: '⌂' },
  { path: '/diary', label: 'Дневник', icon: '✎' },
  { path: '/objects', label: 'Объекты', icon: '❦' },
  { path: '/library', label: 'Статьи', icon: '❑' },
  { path: '/more', label: 'Ещё', icon: '⋯' },
]

/** Круглый «+» справа: ссылка или действие без смены адреса. */
export type ScreenAdd = { label: string; href: string } | { label: string; onClick: () => void }

/** back — запасной путь; onBack — закрыть карточку. leaveGuard — перехват вкладок при несохранённых правках. */
export function Screen(props: {
  title: string
  help?: string
  back?: string
  onBack?: () => void
  /** Если задан: клик по вкладке не уводит сразу — вызывается с целевым путём. */
  leaveGuard?: (path: string) => void
  actions?: ReactNode
  add?: ScreenAdd
  children: ReactNode
  tab: string
}) {
  const tabbar = useRef<HTMLElement>(null)
  const back = useBackTarget(props.back)

  // Высота нижнего меню зависит от размера текста и отступа под полоску жеста iPhone: запас внизу страницы — по факту.
  useEffect(() => {
    const element = tabbar.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      // Пока идёт ввод, меню скрыто и его высота 0. Не обнулять запас: иначе страница сдвигается и «Сохранить» уезжает из-под пальца.
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height <= 0) return
      document.documentElement.style.setProperty('--tabbar-height', `${height}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        {props.onBack ? (
          <button type="button" className="icon-button" aria-label="Назад" onClick={props.onBack}>
            ←
          </button>
        ) : back ? (
          <button type="button" className="icon-button" aria-label="Назад" onClick={() => goBack(props.back)}>
            ←
          </button>
        ) : (
          <span className="topbar-spacer" aria-hidden="true" />
        )}
        <h1>{props.title}</h1>
        <div className="topbar-actions">
          {props.actions}
          {props.help && <HelpButton topic={props.help} />}
          {props.add &&
            ('href' in props.add ? (
              <a className="icon-button add" href={props.add.href} aria-label={props.add.label}>
                +
              </a>
            ) : (
              <button type="button" className="icon-button add" aria-label={props.add.label} onClick={props.add.onClick}>
                +
              </button>
            ))}
        </div>
      </header>
      <UpdateBanner />
      <WorkBadge />
      <main className="content">{props.children}</main>
      <nav ref={tabbar} className="tabbar" aria-label="Разделы">
        {TABS.map((tab) => (
          <a
            key={tab.path}
            href={`#${tab.path}`}
            className={tab.path === props.tab ? 'tab active' : 'tab'}
            onClick={(event) => {
              if (!props.leaveGuard || tab.path === props.tab) return
              event.preventDefault()
              props.leaveGuard(tab.path)
            }}
          >
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
