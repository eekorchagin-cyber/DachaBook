import { describe, expect, it } from 'vitest'
import { errorText, isIdbTransient } from './format'

describe('сообщения об ошибках', () => {
  it('обрыв IndexedDB на iPhone не показывает сырой текст WebKit', () => {
    const error = new Error('Attempt to get a record from database without an in-progress transaction')
    error.name = 'UnknownError'
    expect(isIdbTransient(error)).toBe(true)
    expect(errorText(error)).toMatch(/VPN/)
    expect(errorText(error)).not.toMatch(/in-progress transaction/)
  })

  it('обычная ошибка остаётся как есть', () => {
    expect(errorText(new Error('Папка не найдена'))).toBe('Папка не найдена')
  })
})
