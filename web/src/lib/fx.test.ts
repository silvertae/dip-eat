import { describe, expect, it } from 'vitest'
import { formatHome, rateNow } from './fx'

describe('traveler home currency', () => {
  it('uses the offline fallback in both KRW/JPY directions', () => {
    expect(rateNow('JPY', 'KRW')).toBe(9.1)
    expect(rateNow('KRW', 'JPY')).toBeCloseTo(1 / 9.1)
  })

  it('returns one for the same currency', () => {
    expect(rateNow('JPY', 'JPY')).toBe(1)
    expect(rateNow('KRW', 'KRW')).toBe(1)
  })

  it('formats the selected home currency', () => {
    expect(formatHome(1234, 'KRW')).toContain('1,234')
    expect(formatHome(1234, 'JPY')).toContain('1,234')
  })
})
