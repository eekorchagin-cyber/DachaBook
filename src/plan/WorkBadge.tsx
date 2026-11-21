import { useEffect, useState } from 'react'
import { applyWorkBadge, appBadgeSupported, badgePermission, requestBadgePermission, unfinishedWorkCount, type BadgePermission } from './badge'
import { useWorkStatuses } from './useWorkStatuses'

/** Держит число на значке и при необходимости просит разрешение уведомлений (иначе на iPhone цифры не видно). */
export function WorkBadge() {
  const { list, works } = useWorkStatuses()
  const count = unfinishedWorkCount(list.map((item) => item.status))
  const [permission, setPermission] = useState<BadgePermission>(() => (appBadgeSupported() ? badgePermission() : 'unsupported'))
  const supported = appBadgeSupported()

  useEffect(() => {
    if (!works) return
    void applyWorkBadge(count).catch(() => undefined)
  }, [works, count])

  if (!supported || count === 0 || permission === 'granted' || permission === 'unsupported') return null

  if (permission === 'denied') {
    return (
      <div className="badge-permission-banner" role="status">
        <p>
          Есть работы к выполнению ({count}), но уведомления запрещены — число на значке не появится. Включите их в Настройках iPhone → DachaBook →
          Уведомления.
        </p>
      </div>
    )
  }

  return (
    <div className="badge-permission-banner">
      <p>Чтобы на значке программы было число несделанных работ ({count}), разрешите уведомления. Сами уведомления программа пока не шлёт.</p>
      <button
        type="button"
        className="button small"
        onClick={() => {
          void requestBadgePermission().then((next) => {
            setPermission(next)
            if (next === 'granted') void applyWorkBadge(count).catch(() => undefined)
          })
        }}
      >
        Показывать на значке
      </button>
    </div>
  )
}
