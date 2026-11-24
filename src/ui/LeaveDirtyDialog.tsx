export type LeaveDirtyChoice = 'save' | 'discard' | 'stay'

/** Три исхода при уходе с несохранённой формы: сохранить, выйти без сохранения или остаться. */
export function LeaveDirtyDialog(props: { onChoice: (choice: LeaveDirtyChoice) => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="leave-dirty-title">
        <h2 id="leave-dirty-title">Сохранить изменения?</h2>
        <p>Есть несохранённые правки. Сохранить перед выходом, выйти без сохранения или остаться в форме?</p>
        <div className="actions dialog-actions">
          <button type="button" className="button" onClick={() => props.onChoice('save')}>
            Сохранить
          </button>
          <button type="button" className="button secondary" onClick={() => props.onChoice('discard')}>
            Не сохранять
          </button>
          <button type="button" className="button secondary" onClick={() => props.onChoice('stay')}>
            Остаться
          </button>
        </div>
      </div>
    </div>
  )
}
