import { describe, expect, it } from 'vitest'
import { APP_VERSION, LATEST_CHANGE } from './version'

// The status bar blurb must stay a one-liner. If this fails, shorten
// LATEST_CHANGE in src/version.ts — don't raise the limit.
describe('status bar version blurb', () => {
  it('is very short (fits the status bar)', () => {
    expect(LATEST_CHANGE.length).toBeLessThanOrEqual(80)
  })

  it('does not repeat the version (rendered separately)', () => {
    expect(LATEST_CHANGE).not.toMatch(/^\s*v?\d+\.\d+/)
    expect(LATEST_CHANGE).not.toContain(APP_VERSION)
  })
})

describe('app version', () => {
  it('is valid semver, injected from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
