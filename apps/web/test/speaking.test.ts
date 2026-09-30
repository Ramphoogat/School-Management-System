import { describe, expect, it } from 'vitest'
import { HOLD_MS, SPEAKING_LEVEL, createSpeakingGate, level } from '../src/lib/speaking'

describe('level', () => {
  it('is 0 for silence (bytes at 128) and for no samples', () => {
    expect(level(new Uint8Array(256).fill(128))).toBe(0)
    expect(level([])).toBe(0)
  })
  it('is about 1 for a full-scale signal and rises with volume', () => {
    const loud = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 255 : 0))
    const quiet = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 138 : 118))
    expect(level(loud)).toBeGreaterThan(0.95)
    expect(level(quiet)).toBeGreaterThan(SPEAKING_LEVEL)
    expect(level(quiet)).toBeLessThan(level(loud))
  })
})

describe('createSpeakingGate', () => {
  it('turns on at speech level, stays on briefly after, then off', () => {
    let t = 1000
    const gate = createSpeakingGate(() => t)
    expect(gate(0.001)).toBe(false)
    expect(gate(0.2)).toBe(true)
    t += HOLD_MS - 10
    expect(gate(0.001)).toBe(true) // between words
    t += 20
    expect(gate(0.001)).toBe(false)
  })
  it('ignores steady low noise', () => {
    let t = 0
    const gate = createSpeakingGate(() => t)
    for (let i = 0; i < 20; i++) { t += 120; expect(gate(SPEAKING_LEVEL - 0.01)).toBe(false) }
  })
})
