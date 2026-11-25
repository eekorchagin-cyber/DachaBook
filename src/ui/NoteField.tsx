import { GrowingTextarea } from './GrowingTextarea'

/** Многострочное пояснение к фото: растёт по тексту, можно растянуть вручную. */
export function NoteField(props: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return <GrowingTextarea className="file-note" rows={2} value={props.value} placeholder={props.placeholder} onChange={props.onChange} />
}
