import { useEffect } from 'react'
import { applyWorkBadge, unfinishedWorkCount } from './badge'
import { useWorkStatuses } from './useWorkStatuses'

/** Держит на значке программы число работ, которые пора делать сейчас. */
export function WorkBadge() {
  const { list, works } = useWorkStatuses()
  const count = unfinishedWorkCount(list.map((item) => item.status))
  useEffect(() => {
    if (!works) return
    void applyWorkBadge(count).catch(() => undefined)
  }, [works, count])
  return null
}
