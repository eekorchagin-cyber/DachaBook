import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../storage/db'
import { useWorkContext } from './context'
import { compareStatus, workHistory, workStatus } from './status'

/** Действующие работы с состоянием на сегодня и историей из дневника, по порядку: сначала то, что делать сейчас. */
export function useWorkStatuses() {
  const works = useLiveQuery(() => db.planWorks.filter((work) => !work.deletedAt).toArray(), [])
  const events = useLiveQuery(() => db.events.toArray(), [])
  const context = useWorkContext()
  const list = useMemo(
    () =>
      (works ?? [])
        .filter((work) => work.active)
        .map((work) => {
          const history = workHistory(work, events ?? [])
          return { work, history, status: workStatus(work, history, context) }
        })
        .sort((a, b) => compareStatus(a.status, b.status)),
    [works, events, context],
  )
  return { list, works, context }
}

