import { useSyncExternalStore } from 'react'

export type ResultStatus = 'ok' | 'warn' | 'fail' | 'info'

export interface LabResult {
  status: ResultStatus
  summary: string
  at: string
}

const STORAGE_KEY = 'dachabook-lab-results'
const listeners = new Set<() => void>()

function load(): Record<string, LabResult> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, LabResult>
  } catch {
    return {}
  }
}

let results = load()

export function saveResult(id: string, status: ResultStatus, summary: string): void {
  results = { ...results, [id]: { status, summary, at: new Date().toISOString() } }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(results))
  for (const listener of listeners) listener()
}

export function clearResults(): void {
  results = {}
  localStorage.removeItem(STORAGE_KEY)
  for (const listener of listeners) listener()
}

export function useLabResults(): Record<string, LabResult> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => results,
  )
}
