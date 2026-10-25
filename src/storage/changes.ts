import { db, DOC_TABLES } from './db'

type Listener = () => void
const listeners = new Set<Listener>()
let watching = false

/** Любая запись в документы или файлы: для автокопии и синхронизации. Слушатели вызываются после текущей операции. */
export function onLocalChange(listener: Listener): () => void {
  if (!watching) {
    watching = true
    let queued = false
    const notify = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        for (const item of listeners) item()
      })
    }
    for (const name of [...DOC_TABLES, 'fileContents'] as const) {
      const table = db.table(name)
      table.hook('creating', () => {
        notify()
      })
      table.hook('updating', () => {
        notify()
      })
      table.hook('deleting', () => {
        notify()
      })
    }
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}
