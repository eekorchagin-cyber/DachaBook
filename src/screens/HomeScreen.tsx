import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { PhotoPosition } from '../app/store'
import { versionLabel } from '../app/version'
import { compareEvents } from '../domain/diaryFilter'
import { db } from '../storage/db'
import { EmptyState, Screen } from '../ui/Screen'
import { EventCard } from './diary/EventCard'

export function HomeScreen({ authorName, plotAddress, photoPosition }: { authorName: string; plotAddress: string; photoPosition: PhotoPosition }) {
  const events = useLiveQuery(() => db.events.filter((item) => !item.deletedAt).toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const objectMap = useMemo(() => new Map((objects ?? []).map((item) => [item.id, item])), [objects])
  const latest = [...(events ?? [])].sort(compareEvents).slice(0, 5)

  return (
    <Screen title="DachaBook" help="home" tab="/">
      <p className="muted">Здравствуйте, {authorName}!</p>
      {plotAddress ? (
        <p className="plot-address">📍 {plotAddress}</p>
      ) : (
        <p className="hint">
          <a className="plot-address-link" href="#/settings">
            Укажите адрес дачи в настройках
          </a>
        </p>
      )}
      <div className="quick-actions">
        <a className="button big" href="#/diary/new">
          ✎ Новая запись
        </a>
        <a className="button big secondary" href="#/diary/new?type=measurement">
          🌡 Измерение почвы
        </a>
      </div>
      <section className="card">
        <h2>Погода на участке</h2>
        <dl className="facts">
          <dt>Температура воздуха</dt>
          <dd>—</dd>
          <dt>Прогноз</dt>
          <dd>—</dd>
        </dl>
        <p className="hint">Текущая погода и прогноз для участка появятся на этапе 4.</p>
      </section>
      <section className="card">
        <h2>Ближайшие работы</h2>
        <p className="hint">План работ и погода появятся на этапе 4. Черновик плана из Evernote — в разделе «Ещё».</p>
      </section>
      <h2 className="section-title">Последние записи</h2>
      {events && latest.length === 0 && <EmptyState>Записей пока нет. Начните с кнопки «Новая запись».</EmptyState>}
      {latest.map((event) => (
        <EventCard key={event.id} event={event} objects={objectMap} photoPosition={photoPosition} />
      ))}
      {latest.length > 0 && (
        <a className="button secondary" href="#/diary">
          Весь дневник
        </a>
      )}
      <p className="version app-version">{versionLabel()}</p>
    </Screen>
  )
}
