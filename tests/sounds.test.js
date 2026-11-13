// Kısa uyarı sesleri: Web Audio osilatörleriyle üretilir (ses dosyası yok).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { playBeep, startLoop, BEEPS, LOOPS } from '../src/voice/sounds.js'

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

describe('startLoop (DM aramasında bekleme tonu)', () => {
  afterEach(() => vi.useRealTimers())

  it('hemen çalar, aralıkla tekrarlar; durdurunca sayaç kalmaz ve çalan nota kesilir', () => {
    vi.useFakeTimers()
    const { Ctx, kayit } = sahteCtx()
    const durdur = startLoop('bekleme', { AudioContext: Ctx })
    const notaSayisi = BEEPS.bekleme.length
    expect(kayit.osc).toHaveLength(notaSayisi)
    vi.advanceTimersByTime(LOOPS.bekleme.aralikMs)
    expect(kayit.osc).toHaveLength(notaSayisi * 2)
    durdur()
    expect(vi.getTimerCount()).toBe(0)
    expect(kayit.osc.at(-1).bitir).toBeUndefined() // stop() argümansız: hemen kesildi
    vi.advanceTimersByTime(LOOPS.bekleme.aralikMs * 3)
    expect(kayit.osc).toHaveLength(notaSayisi * 2)
    durdur() // ikinci kez çağırmak sorun değil
  })

  it('bilinmeyen ad ya da Web Audio yoksa sessiz; durdurma yine güvenli', () => {
    vi.useFakeTimers()
    expect(() => startLoop('yok')()).not.toThrow()
    const durdur = startLoop('bekleme') // Node'da AudioContext yok
    durdur()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('gelen arama zili (LOOPS.zil)', () => {
  afterEach(() => vi.useRealTimers())

  it('kısa, döngülü, bekleme tonundan farklı; durdurunca sayaç kalmaz', () => {
    vi.useFakeTimers()
    expect(LOOPS.zil.nota).toBe('zil')
    expect(BEEPS.zil.length).toBeGreaterThan(0)
    expect(BEEPS.zil.reduce((t, [, sure]) => t + sure, 0)).toBeLessThan(1) // kısa
    expect(BEEPS.zil).not.toEqual(BEEPS.bekleme)
    const { Ctx, kayit } = sahteCtx()
    const durdur = startLoop('zil', { AudioContext: Ctx })
    expect(kayit.osc).toHaveLength(BEEPS.zil.length)
    vi.advanceTimersByTime(LOOPS.zil.aralikMs)
    expect(kayit.osc).toHaveLength(BEEPS.zil.length * 2)
    durdur()
    expect(vi.getTimerCount()).toBe(0)
  })
})
