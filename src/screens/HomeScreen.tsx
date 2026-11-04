import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate } from '../app/router'
import type { PhotoPosition } from '../app/store'
import { versionLabel } from '../app/version'
import { compareEvents } from '../domain/diaryFilter'
import { searchProgram, type ProgramSection } from '../domain/programSearch'
import type { DiaryEvent } from '../domain/types'
import { htmlToText } from '../lib/sanitize'
import { db } from '../storage/db'
import { syncSummary, useSyncStatus } from '../sync/runner'
import { AutoBackupWarning } from '../ui/AutoBackup'
import { DateJump } from '../ui/DateJump'
import { PlotPhoto } from '../ui/PlotPhoto'
import { WeatherCard } from '../ui/WeatherCard'
import { EmptyState, Screen } from '../ui/Screen'
import { EventCard } from './diary/EventCard'
import { TodaySignCard } from './FolkSignsScreen'
import { UpcomingWateringCard } from './WateringScreen'
import { UpcomingWorksCard } from './WorksScreen'

export function HomeScreen({
  authorName,
  plotAddress,
  photoPosition,
  plotPhotoId,
}: {
  authorName: string
  plotAddress: string
  photoPosition: PhotoPosition
  plotPhotoId: string
}) {
  const events = useLiveQuery(() => db.events.filter((item) => !item.deletedAt).toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const objectMap = useMemo(() => new Map((objects ?? []).map((item) => [item.id, item])), [objects])
  const consumables = useLiveQuery(() => db.consumables.toArray(), [])
  const consumableMap = useMemo(() => new Map((consumables ?? []).map((item) => [item.id, item])), [consumables])
  const signs = useLiveQuery(() => db.folkSigns.filter((sign) => !sign.deletedAt).toArray(), [])
  const latest = [...(events ?? [])].sort(compareEvents).slice(0, 5)

  return (
    <Screen title="DachaBook" help="home" tab="/" actions={<HomeLookup events={events ?? []} />}>
      {plotPhotoId && (
        <a className="plot-hero" href="#/settings?part=plot">
          <PlotPhoto id={plotPhotoId} />
        </a>
      )}
      <p className="muted">Здравствуйте, {authorName}!</p>
      {plotAddress ? (
        <p className="plot-address">📍 {plotAddress}</p>
      ) : (
        <p className="hint">
          <a className="plot-address-link" href="#/settings?part=plot">
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
          🌡 Измерения
        </a>
      </div>
      <WeatherCard />
      {signs && <TodaySignCard signs={signs} />}
      <UpcomingWorksCard />
      <UpcomingWateringCard />
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

function HomeLookup({ events }: { events: DiaryEvent[] }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <>
      <button type="button" className="icon-button" aria-label="Поиск и переход к дате" onClick={() => setOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
            <div className="sheet home-lookup" role="dialog" aria-modal="true" aria-label="Поиск и переход к дате" onClick={(event) => event.stopPropagation()}>
              <h2>Дневник</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  setOpen(false)
                  navigate(`/diary?text=${encodeURIComponent(text.trim())}`)
                }}
              >
                <label className="field">
                  Поиск по дневнику
                  <input type="search" value={text} placeholder="Например: редис" aria-label="Поиск по дневнику" onChange={(event) => setText(event.target.value)} />
                </label>
                <div className="actions">
                  <button type="submit" className="button">
                    Найти
                  </button>
                </div>
              </form>
              <ProgramSearch onOpen={() => setOpen(false)} />
              <DateJump events={events} />
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function ProgramSearch({ onOpen }: { onOpen: () => void }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const found = useLiveQuery(async () => {
    if (!query) return [] as ProgramSection[]
    const [references, files, works, objects, groups, consumables, events, zones, signs] = await Promise.all([
      db.references.filter((item) => !item.deletedAt).toArray(),
      db.files.toArray(),
      db.planWorks.filter((item) => !item.deletedAt).toArray(),
      db.objects.filter((item) => !item.deletedAt).toArray(),
      db.plantGroups.filter((item) => !item.deletedAt).toArray(),
      db.consumables.filter((item) => !item.deletedAt).toArray(),
      db.events.filter((item) => !item.deletedAt).toArray(),
      db.wateringZones.filter((item) => !item.deletedAt).toArray(),
      db.folkSigns.filter((item) => !item.deletedAt).toArray(),
    ])
    const fileName = new Map(files.map((file) => [file.id, file.fileName]))
    const objectName = new Map(objects.map((item) => [item.id, item.name]))
    const groupName = new Map(groups.map((item) => [item.id, item.name]))
    const names = (ids: string[], map: Map<string, string>) => ids.map((id) => map.get(id)).filter(Boolean).join(' ')
    return searchProgram(query, {
      articles: references.map((item) => ({
        title: item.title,
        text: [item.tags.join(' '), htmlToText(item.html), item.fileIds.map((id) => fileName.get(id)).filter(Boolean).join(' ')].join(' '),
        href: `#/library/${item.id}`,
      })),
      works: works.map((item) => ({
        title: item.title,
        text: [item.workKind, item.note, names(item.objectIds, objectName), names(item.plantGroupIds, groupName)].filter(Boolean).join(' '),
        href: `#/works?work=${item.id}`,
      })),
      events: events.map((item) => ({
        title: item.comment.slice(0, 80) || item.workKind || 'Запись дневника',
        text: [item.comment, item.workKind].filter(Boolean).join(' '),
        href: `#/diary/${item.id}`,
      })),
      consumables: consumables.map((item) => ({
        title: item.name,
        text: [item.kind, item.description, item.note].filter(Boolean).join(' '),
        href: `#/consumables?id=${item.id}`,
      })),
      objects: objects.map((item) => ({ title: item.name, text: item.description ?? '', href: '#/objects' })),
      groups: groups.map((item) => ({ title: item.name, text: item.description ?? '', href: '#/objects?view=groups' })),
      zones: zones.map((item) => ({ title: item.name, text: '', href: '#/watering' })),
      signs: signs.map((item) => ({ title: item.title || item.text.slice(0, 80), text: item.text, href: '#/signs' })),
    })
  }, [query])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setQuery(text.trim())
      }}
    >
      <h2>Поиск по всей программе</h2>
      <label className="field">
        Статьи, план работ, материалы, объекты
        <input type="search" value={text} placeholder="Например: астильба" aria-label="Поиск по всей программе" onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="button">
          Найти
        </button>
      </div>
      {query && found && found.length === 0 && <p className="hint">Ничего не найдено.</p>}
      {found?.map((section) => (
        <section key={section.title}>
          <h3 className="section-title">{section.title}</h3>
          <ul className="list">
            {section.hits.map((hit, index) => (
              <li key={`${hit.href}-${index}`}>
                <a className="list-item" href={hit.href} onClick={onOpen}>
                  <strong>{hit.title}</strong>
                  {hit.excerpt && <span className="muted excerpt">{hit.excerpt}</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </form>
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
