import { describe, expect, it } from 'vitest'
import {
  pathFromHash,
  previousPath,
  rememberNavigationForTests,
  resetNavigationForTests,
  resolveBack,
  routeKey,
} from './router'

describe('возврат на предыдущий экран', () => {
  it('нормализует hash в путь приложения', () => {
    expect(pathFromHash('')).toBe('/')
    expect(pathFromHash('#')).toBe('/')
    expect(pathFromHash('#/')).toBe('/')
    expect(pathFromHash('#/sync')).toBe('/sync')
    expect(pathFromHash('#sync')).toBe('/sync')
    expect(pathFromHash('#/diary?text=газон')).toBe('/diary?text=газон')
  })

  it('считает один экран с разным back одним и тем же', () => {
    expect(routeKey('/sync')).toBe('/sync')
    expect(routeKey('/sync?back=/')).toBe('/sync')
    expect(routeKey('/diary?text=a&back=/')).toBe('/diary?text=a')
  })

  it('берёт ?back=, иначе верх стека, иначе запасной', () => {
    expect(resolveBack('/more/cloud', '/', '/diary', '/sync')).toBe('/')
    expect(resolveBack('/more/cloud', null, '/more/cloud', '/sync')).toBe('/more/cloud')
    expect(resolveBack('/more/cloud', null, undefined, '/sync')).toBe('/more/cloud')
    expect(resolveBack('/more/cloud', '/sync', '/more/cloud', '/sync')).toBe('/more/cloud')
  })

  it('по вложенному меню поднимается вверх и не прыгает обратно вниз', () => {
    resetNavigationForTests('/more', [])
    rememberNavigationForTests('/more/program')
    rememberNavigationForTests('/more/cloud')
    rememberNavigationForTests('/sync')
    expect(previousPath()).toBe('/more/cloud')
    expect(resolveBack('/more/cloud')).toBe('/more/cloud')

    rememberNavigationForTests('/more/cloud')
    expect(previousPath()).toBe('/more/program')
    expect(resolveBack('/more/program')).toBe('/more/program')

    rememberNavigationForTests('/more/program')
    expect(previousPath()).toBe('/more')
    expect(resolveBack('/more')).toBe('/more')
  })

  it('с главной в облако возвращает на главную, а не в меню облака', () => {
    resetNavigationForTests('/', [])
    rememberNavigationForTests('/sync')
    expect(resolveBack('/more/cloud')).toBe('/')
  })

  it('нижнее меню сбрасывает вложенную историю', () => {
    resetNavigationForTests('/more', [])
    rememberNavigationForTests('/more/cloud')
    rememberNavigationForTests('/sync')
    rememberNavigationForTests('/diary')
    expect(previousPath()).toBeUndefined()
    expect(resolveBack(undefined)).toBeUndefined()
  })
})
