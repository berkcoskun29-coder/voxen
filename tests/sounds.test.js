// Kısa uyarı sesleri: Web Audio osilatörleriyle üretilir (ses dosyası yok).
import { describe, it, expect } from 'vitest'
import { playBeep, BEEPS } from '../src/voice/sounds.js'

// Sahte AudioContext: kaç osilatör başlatıldığını sayar
function sahteCtx() {
  const kayit = { osc: [] }
  class Ctx {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; kayit.ctx = this }
    createOscillator() {
      const o = { frequency: { value: 0 }, connect() {}, start(t) { this.basla = t }, stop(t) { this.bitir = t } }
      kayit.osc.push(o)
      return o
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} } }
  }
  return { Ctx, kayit }
}

describe('playBeep', () => {
  it("'join' ve 'leave' iki notalık kısa ses çalar (yükselen / alçalan)", () => {
    const { Ctx, kayit } = sahteCtx()
    expect(playBeep('join', { AudioContext: Ctx })).toBe(true)
    expect(kayit.osc.map((o) => o.frequency.value)).toEqual([523, 784])
    expect(kayit.osc[1].basla).toBeCloseTo(kayit.osc[0].bitir) // arka arkaya
    const l = sahteCtx()
    playBeep('leave', { AudioContext: l.Ctx })
    expect(l.kayit.osc.map((o) => o.frequency.value)).toEqual([784, 523])
  })

  it("Görev 8 için 'ptt-on' / 'ptt-off' adları da tanınır", () => {
    expect(Object.keys(BEEPS)).toEqual(expect.arrayContaining(['join', 'leave', 'ptt-on', 'ptt-off']))
    const { Ctx, kayit } = sahteCtx()
    expect(playBeep('ptt-on', { AudioContext: Ctx })).toBe(true)
    expect(kayit.osc).toHaveLength(1)
  })

  it('bilinmeyen ad ya da Web Audio yoksa sessizce false döner', () => {
    const { Ctx } = sahteCtx()
    expect(playBeep('yok', { AudioContext: Ctx })).toBe(false)
    expect(playBeep('join')).toBe(false) // Node'da AudioContext yok
  })
})
