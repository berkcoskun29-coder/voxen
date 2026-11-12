import { describe, it, expect } from 'vitest'
import { rmsLevel, isSpeaking } from '../src/voice/level.js'

describe('rmsLevel', () => {
  it('sessizlikte 0 döner', () => {
    expect(rmsLevel(new Float32Array(1024))).toBe(0)
  })
  it('tam genlikli sinüste yaklaşık 0.707 döner', () => {
    const x = new Float32Array(4800)
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 100 * i) / 48000)
    expect(rmsLevel(x)).toBeCloseTo(0.707, 2)
  })
  it('boş dizide 0 döner', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0)
  })
})

describe('isSpeaking', () => {
  it('eşiğin üstü konuşma sayılır', () => {
    expect(isSpeaking(0.05)).toBe(true)
    expect(isSpeaking(0.01)).toBe(false)
    expect(isSpeaking(0.1, 0.2)).toBe(false)
  })
})
