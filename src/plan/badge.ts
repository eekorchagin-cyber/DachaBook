import type { WorkStatus } from './status'

/** На значке — работы, которые пора делать сейчас: готовые и с прошедшим сроком. */
export function unfinishedWorkCount(statuses: Pick<WorkStatus, 'state' | 'closed'>[]): number {
  return statuses.filter((status) => !status.closed && (status.state === 'ready' || status.state === 'overdue')).length
}

/** Badging API есть (на iPhone — только у программы с домашнего экрана). */
export function appBadgeSupported(
  badge: { setAppBadge?: (count?: number) => Promise<void> } = typeof navigator === 'undefined' ? {} : navigator,
): boolean {
  return typeof badge.setAppBadge === 'function'
}

export type BadgePermission = NotificationPermission | 'unsupported'

/** На iPhone число на значке видно только после разрешения уведомлений. */
export function badgePermission(): BadgePermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Запрос разрешения: на iPhone без него setAppBadge запоминает число, но на значке его не видно. */
export async function requestBadgePermission(): Promise<BadgePermission> {
  if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') return 'unsupported'
  return Notification.requestPermission()
}

/**
 * Цифра на значке программы.
 * На iPhone появляется после «Разрешить» в уведомлениях; пока программа закрыта, сайт значок сам не меняет.
 */
export async function applyWorkBadge(
  count: number,
  badge: {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  } = typeof navigator === 'undefined' ? {} : navigator,
): Promise<void> {
  if (typeof badge.setAppBadge !== 'function') return
  if (count > 0) {
    await badge.setAppBadge(count)
    return
  }
  if (typeof badge.clearAppBadge === 'function') await badge.clearAppBadge()
  else await badge.setAppBadge(0)
}
