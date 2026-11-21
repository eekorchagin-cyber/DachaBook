import { describe, expect, it } from 'vitest'
import { pathFromHash, resolveBack, routeKey } from './router'

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

  it('берёт ?back=, иначе экран откуда пришли, иначе запасной', () => {
    expect(resolveBack('/more/cloud', '/', '/diary', '/sync')).toBe('/')
    expect(resolveBack('/more/cloud', null, '/more/cloud', '/sync')).toBe('/more/cloud')
    expect(resolveBack('/more/cloud', null, undefined, '/sync')).toBe('/more/cloud')
    expect(resolveBack('/more/cloud', '/sync', '/more/cloud', '/sync')).toBe('/more/cloud')
    expect(resolveBack('/more/cloud', null, '/sync?back=/', '/sync')).toBe('/more/cloud')
  })
})
