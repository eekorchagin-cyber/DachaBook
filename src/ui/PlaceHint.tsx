import type { StorageSuggestion } from '../domain/placeSuggestion'

/** Подсказка, куда положить новый материал, чтобы похожее лежало рядом. */
export function PlaceHint({ suggestion, applyKind, onAccept }: { suggestion: StorageSuggestion; applyKind: boolean; onAccept: () => void }) {
  const kind = applyKind ? suggestion.kind : undefined
  if (!suggestion.place && !kind) return null
  const neighbors = suggestion.neighbors.slice(0, 3).join(', ')
  const text = suggestion.place
    ? `Положить к «${suggestion.place}»${neighbors ? `: там уже ${neighbors}` : ''}.${kind ? ` Вид — «${kind}».` : ''}`
    : `Отнести к виду «${kind}», чтобы оно лежало рядом с такими же.`
  return (
    <div className="place-suggestion">
      <p className="hint">{text}</p>
      <button type="button" className="button secondary small" onClick={onAccept}>
        {suggestion.place ? 'Положить туда' : 'Отнести к этому виду'}
      </button>
    </div>
  )
}
