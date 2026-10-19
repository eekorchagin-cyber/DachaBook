import { useState, type ReactNode } from 'react'
import { errorText } from '../lib/format'
import type { LabResult, ResultStatus } from '../lab/results'

const STATUS_LABEL: Record<ResultStatus, string> = {
  ok: 'работает',
  warn: 'есть замечания',
  fail: 'не работает',
  info: 'сведения',
}

export function StatusBadge({ result }: { result?: LabResult }) {
  if (!result) return <span className="badge badge-none">не проверено</span>
  return <span className={`badge badge-${result.status}`}>{STATUS_LABEL[result.status]}</span>
}

export function Section(props: { title: string; result?: LabResult; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{props.title}</h2>
        <StatusBadge result={props.result} />
      </header>
      {props.hint && <p className="hint">{props.hint}</p>}
      {props.children}
      {props.result && <p className="result-summary">{props.result.summary}</p>}
    </section>
  )
}

/** Кнопка, которая блокируется на время действия и показывает ошибку обычным текстом. */
export function ActionButton(props: {
  onRun: () => Promise<void>
  children: ReactNode
  disabled?: boolean
  secondary?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="action">
      <button
        type="button"
        className={props.secondary ? 'button secondary' : 'button'}
        disabled={busy || props.disabled}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await props.onRun()
          } catch (caught) {
            setError(errorText(caught))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Выполняется…' : props.children}
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  )
}

export function LogView({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <ol className="log">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ol>
  )
}
