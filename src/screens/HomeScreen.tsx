import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { PhotoPosition } from '../app/store'
import { versionLabel } from '../app/version'
import { compareEvents } from '../domain/diaryFilter'
import { db } from '../storage/db'
import { syncSummary, useSyncStatus } from '../sync/runner'
import { AutoBackupWarning } from '../ui/AutoBackup'
import { DateJump } from '../ui/DateJump'
import { WeatherCard } from '../ui/WeatherCard'
import { EmptyState, Screen } from '../ui/Screen'
import { EventCard } from './diary/EventCard'
import { TodaySignCard } from './FolkSignsScreen'
import { UpcomingWorksCard } from './WorksScreen'

export function HomeScreen({ authorName, plotAddress, photoPosition }: { authorName: string; plotAddress: string; photoPosition: PhotoPosition }) {
  const events = useLiveQuery(() => db.events.filter((item) => !item.deletedAt).toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const objectMap = useMemo(() => new Map((objects ?? []).map((item) => [item.id, item])), [objects])
  const consumables = useLiveQuery(() => db.consumables.toArray(), [])
  const consumableMap = useMemo(() => new Map((consumables ?? []).map((item) => [item.id, item])), [consumables])
  const signs = useLiveQuery(() => db.folkSigns.filter((sign) => !sign.deletedAt).toArray(), [])
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
      <SyncLine />
      <AutoBackupWarning />
      <div className="quick-actions">
        <a className="button big" href="#/diary/new">
          ✎ Новая запись
        </a>
        <a className="button big secondary" href="#/diary/new?type=measurement">
          🌡 Измерения почвы
        </a>
      </div>
      <WeatherCard />
      {signs && <TodaySignCard signs={signs} />}
      <UpcomingWorksCard />
      {events && <DateJump events={events} />}
      <h2 className="section-title">Последние записи</h2>
      {events && latest.length === 0 && <EmptyState>Записей пока нет. Начните с кнопки «Новая запись».</EmptyState>}
      {latest.map((event) => (
        <EventCard key={event.id} event={event} objects={objectMap} consumables={consumableMap} photoPosition={photoPosition} />
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

function SyncLine() {
  const status = useSyncStatus()
  if (!status.connected) {
    return (
      <a className="sync-line" href="#/sync">
        ☁ Облако не подключено — дневник хранится только на этом устройстве. Подключить
      </a>
    )
  }
  const summary = syncSummary(status)
  return (
    <a className={summary.warning ? 'sync-line warning' : 'sync-line'} href={status.conflicts > 0 ? '#/conflicts' : '#/sync'}>
      ☁ {summary.text}
    </a>
  )
}
