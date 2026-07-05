import { describe, it, expect } from 'vitest'
import { complexityMode, POWER_USER_ACCOUNTS, ALTS_PER_ACCOUNT } from './capacity'

describe('complexityMode', () => {
  it('is simple for an empty empire', () => {
    expect(complexityMode(0)).toBe('simple')
  })

  it('stays simple up to and including the power-user account threshold', () => {
    // POWER_USER_ACCOUNTS full accounts is still simple (> is the cutoff).
    expect(complexityMode(POWER_USER_ACCOUNTS * ALTS_PER_ACCOUNT)).toBe('simple')
  })

  it('flips to complex once a partial account past the threshold exists', () => {
    expect(complexityMode(POWER_USER_ACCOUNTS * ALTS_PER_ACCOUNT + 1)).toBe('complex')
  })

  it('rounds partial accounts up (alts on a 4th account count as a 4th account)', () => {
    // With POWER_USER_ACCOUNTS = 3: 9 alts = 3 accounts (simple),
    // 10 alts = ceil(10/3) = 4 accounts (complex).
    expect(complexityMode(9)).toBe('simple')
    expect(complexityMode(10)).toBe('complex')
  })
})
