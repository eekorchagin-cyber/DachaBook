import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { AppSettings } from '../../app/store'
import { formatDate, todayAtSite } from '../../domain/dates'
import { monthDay, sameDayByYear, shiftDate } from '../../domain/sameDay'
import { db } from '../../storage/db'
import { EmptyState, Screen } from '../../ui/Screen'
import { EventCard } from './EventCard'

/** Записи одного числа за все годы. Дата в адресе: #/diary/day?date=ГГГГ-ММ-ДД. */
export function SameDayScreen({ settings, date }: { settings: AppSettings; date?: string }) {
  const chosen = date && monthDay(date) ? date : todayAtSite().date
  const events = useLiveQuery(() => db.events.toArray(), [])
  const objects = useLiveQuery(() => db.objects.toArray(), [])
  const consumables = useLiveQuery(() => db.consumables.toArray(), [])
  const objectMap = useMemo(() => new Map((objects ?? []).map((item) => [item.id, item])), [objects])
  const consumableMap = useMemo(() => new Map((consumables ?? []).map((item) => [item.id, item])), [consumables])
  const groups = events ? sameDayByYear(events, chosen) : undefined
  const years = groups?.length ?? 0

  return (
    <Screen title="В этот день" help="diary" back="/diary" tab="/diary">
      <div className="actions">
        <a className="button secondary small" href={`#/diary/day?date=${shiftDate(chosen, -1)}`}>
          Предыдущий день
        </a>
        <a className="button secondary small" href={`#/diary/day?date=${shiftDate(chosen, 1)}`}>
          Следующий день
        </a>
      </div>
      <label className="field">
        Число
        <input
          type="date"
          value={chosen}
          onChange={(event) => {
            if (monthDay(event.target.value)) location.hash = `#/diary/day?date=${event.target.value}`
          }}
        />
      </label>
      <p className="hint">
        {formatDate(chosen)} в разные годы.
        {groups && ` ${years === 0 ? 'Записей нет.' : `Годов с записями: ${years}.`}`}{' '}
        <a href={`#/diary?from=${chosen}&to=${chosen}`}>Открыть этот день в ленте</a>
      </p>
      {groups && years === 0 && <EmptyState>В этот день записей пока нет. Выберите другое число или добавьте запись в дневник.</EmptyState>}
      {groups?.map((group) => (
        <section key={group.year}>
          <h2 className="section-title">{group.year}</h2>
          {group.events.map((event) => (
            <EventCard key={event.id} event={event} objects={objectMap} consumables={consumableMap} photoPosition={settings.photoPosition} />
          ))}
        </section>
      ))}
    </Screen>
  )
}
