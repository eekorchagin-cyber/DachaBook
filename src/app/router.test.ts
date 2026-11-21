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

  it('смена даты или фильтра на том же экране не зацикливает «назад»', () => {
    resetNavigationForTests('/diary', [])
    rememberNavigationForTests('/diary/day?date=2026-11-20')
    rememberNavigationForTests('/diary/day?date=2026-11-19')
    rememberNavigationForTests('/diary/day?date=2026-11-21')
    expect(previousPath()).toBe('/diary')
    expect(resolveBack('/diary')).toBe('/diary')

    resetNavigationForTests('/more/program', [])
    rememberNavigationForTests('/settings?part=account')
    rememberNavigationForTests('/settings?part=plot')
    expect(previousPath()).toBe('/more/program')
    expect(resolveBack('/more/program')).toBe('/more/program')
  })

  it('из проверки обновлений поднимается в сервис, затем в ещё — без возврата вниз', () => {
    resetNavigationForTests('/more', [])
    rememberNavigationForTests('/more/service')
    rememberNavigationForTests('/settings?part=updates')
    expect(resolveBack('/more/service')).toBe('/more/service')

    rememberNavigationForTests('/more/service')
    expect(previousPath()).toBe('/more')
    expect(resolveBack('/more')).toBe('/more')

    rememberNavigationForTests('/more')
    expect(previousPath()).toBeUndefined()
  })

  it('если закрытый экран ошибочно снова попал в стек, возврат всё равно срезает его', () => {
    resetNavigationForTests('/settings?part=updates', ['/more', '/more/service', '/settings?part=updates'])
    rememberNavigationForTests('/more/service')
    expect(previousPath()).toBe('/more')
    expect(resolveBack('/more')).toBe('/more')
  })
})
