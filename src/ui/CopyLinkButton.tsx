import { useState } from 'react'
import { useSettings } from '../app/store'
import { labelProgramTarget } from '../domain/labelProgram'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.append(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Открыть адрес программы в том же щелчке, пока браузер ещё считает его действием пользователя. */
export function openLabelProgram(target: string): void {
  const anchor = document.createElement('a')
  anchor.href = target
  if (target.startsWith('http://') || target.startsWith('https://')) {
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
  }
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/** Копирует ссылку и сразу открывает назначенную программу печати меток. */
export function CopyLinkButton({ link }: { link: string }) {
  const settings = useSettings()
  const [notice, setNotice] = useState<'copied' | 'opened' | 'failed' | null>(null)
  const program = settings?.labelProgram
  const target = labelProgramTarget(program?.url ?? '')
  const name = program?.name.trim()

  const copy = () => {
    if (target) openLabelProgram(target)
    void copyText(link).then((ok) => setNotice(ok ? (target ? 'opened' : 'copied') : 'failed'))
  }

  return (
    <div className="copy-link">
      <button type="button" className="button secondary" onClick={copy}>
        Скопировать ссылку
      </button>
      {notice === 'opened' && <p className="hint">{name ? `Ссылка скопирована. Открыта «${name}» — вставьте её в метку.` : 'Ссылка скопирована. Программа для печати открыта — вставьте ссылку в метку.'}</p>}
      {notice === 'copied' && (
        <p className="hint">
          Ссылка скопирована. <a href="#/settings?part=labels">Назначьте программу для печати меток</a>, и она откроется сразу после этой кнопки.
        </p>
      )}
      {notice === 'failed' && (
        <p className="error">
          {target ? 'Программа открыта, но ссылку скопировать не удалось. Выделите её и скопируйте вручную.' : 'Ссылку скопировать не удалось. Выделите её и скопируйте вручную.'}
        </p>
      )}
    </div>
  )
}
