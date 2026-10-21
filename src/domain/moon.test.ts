import { describe, expect, it } from 'vitest'
import { moonPhase } from './moon'

describe('moonPhase', () => {
  it('совпадает с известными фазами', () => {
    expect(moonPhase('2025-09-07').name).toBe('полнолуние')
    expect(moonPhase('2025-09-21').name).toBe('новолуние')
    expect(moonPhase('2024-12-30').name).toBe('новолуние')
    expect(moonPhase('2024-12-15').name).toBe('полнолуние')
    expect(moonPhase('2025-05-04').name).toBe('первая четверть')
  })
})
