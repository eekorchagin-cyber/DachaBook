import type { WorkStatus } from './status'

/** На значке — работы, которые пора делать сейчас: готовые и с прошедшим сроком. */
export function unfinishedWorkCount(statuses: Pick<WorkStatus, 'state' | 'closed'>[]): number {
  return statuses.filter((status) => !status.closed && (status.state === 'ready' || status.state === 'overdue')).length
}

/** Цифра на значке программы. Пока программа закрыта, сайт на iPhone значок не меняет. */
export async function applyWorkBadge(
  count: number,
  badge: { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> } = navigator,
): Promise<void> {
  if (!badge.setAppBadge || !badge.clearAppBadge) return
  if (count > 0) await badge.setAppBadge(count)
  else await badge.clearAppBadge()
}
