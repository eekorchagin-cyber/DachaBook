import { useState } from 'react'
import { HELP } from '../help/texts'

export function HelpButton({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false)
  const help = HELP[topic]
  if (!help) return null
  return (
    <>
      <button type="button" className="icon-button" aria-label="Помощь" onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={`Помощь: ${help.title}`} onClick={(event) => event.stopPropagation()}>
            <h2>Помощь: {help.title}</h2>
            {help.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <button type="button" className="button" onClick={() => setOpen(false)}>
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  )
}
