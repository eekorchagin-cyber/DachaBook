import { describe, expect, it } from 'vitest'
import { applyWorkBadge, unfinishedWorkCount } from './badge'

describe('значок невыполненных работ', () => {
  it('считает готовые и просроченные, закрытые и будущие не берёт', () => {
    expect(
      unfinishedWorkCount([
        { state: 'ready' },
        { state: 'overdue' },
        { state: 'overdue', closed: true },
        { state: 'soon' },
        { state: 'planned' },
        { state: 'done' },
        { state: 'waiting' },
      ]),
    ).toBe(2)
  })

  it('ставит число на значок и снимает его, когда таких работ нет', async () => {
    const calls: unknown[] = []
    const badge = {
      setAppBadge: async (count: number) => {
        calls.push(['set', count])
      },
      clearAppBadge: async () => {
        calls.push(['clear'])
      },
    }
    await applyWorkBadge(3, badge)
    await applyWorkBadge(0, badge)
    expect(calls).toEqual([['set', 3], ['clear']])
    await applyWorkBadge(1, {})
  })
})
