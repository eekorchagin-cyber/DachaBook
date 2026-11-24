/** Простое подтверждение в странице: системный confirm в PWA часто молча возвращает false. */
export function ConfirmDialog(props: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 id="confirm-dialog-title">{props.title}</h2>
        <p>{props.message}</p>
        <div className="actions dialog-actions">
          <button type="button" className="button" onClick={props.onConfirm}>
            {props.confirmLabel ?? 'Да'}
          </button>
          <button type="button" className="button secondary" onClick={props.onCancel}>
            {props.cancelLabel ?? 'Отмена'}
          </button>
        </div>
      </div>
    </div>
  )
}
