import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openMic, createVoicePipeline } from '../src/voice/pipeline.js'

// --- Çok küçük sahte Web Audio düzeneği ---
function sahteDugum(extra = {}) {
  return { connect: vi.fn(), disconnect: vi.fn(), ...extra }
}
class SahteAudioContext {
  constructor(opts) {
    this.opts = opts
    this.audioWorklet = { addModule: vi.fn(async () => {}) }
    this.close = vi.fn(async () => {})
    SahteAudioContext.son = this
  }
  createMediaStreamSource() { return sahteDugum() }
  createGain() { return sahteDugum({ gain: { value: 1 } }) }
  createAnalyser() {
    return sahteDugum({ fftSize: 0, getFloatTimeDomainData: (a) => a.fill(0.5) })
  }
  createMediaStreamDestination() { return sahteDugum({ stream: { id: 'cikis' } }) }
}

describe('openMic', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  const kur = (adi) => vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: adi })) },
  })

  it('NotAllowedError -> denied', async () => {
    kur('NotAllowedError')
    await expect(openMic()).rejects.toMatchObject({ code: 'denied' })
  })
  it('NotFoundError -> no-mic', async () => {
    kur('NotFoundError')
    await expect(openMic()).rejects.toMatchObject({ code: 'no-mic' })
  })
  it('doğru kısıtlarla çağırır', async () => {
    const gum = vi.fn().mockResolvedValue({ id: 's' })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
    await openMic('abc')
    expect(gum.mock.calls[0][0].audio).toMatchObject({
      echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1,
      deviceId: { exact: 'abc' },
    })
  })
})

describe('createVoicePipeline', () => {
  const mic = { getTracks: () => [{ stop: vi.fn() }] }
  const rnnoise = sahteDugum()
  const deps = { AudioContext: SahteAudioContext, createRnnoise: async () => rnnoise }

  it('48 kHz bağlam açar ve kapı kapanınca kazanç 0 olur', async () => {
    const p = await createVoicePipeline(mic, { noiseSuppression: true }, deps)
    expect(SahteAudioContext.son.opts.sampleRate).toBe(48000)
    expect(p.outputStream.id).toBe('cikis')
    p.setGate(false)
    expect(p.gateGain()).toBe(0)
    p.setGate(true)
    expect(p.gateGain()).toBe(1)
  })

  it('getLevel analizörden RMS okur', async () => {
    const p = await createVoicePipeline(mic, { noiseSuppression: true }, deps)
    expect(p.getLevel()).toBeCloseTo(0.5, 5)
  })

  it('close mikrofonu durdurur ve bağlamı kapatır', async () => {
    const stop = vi.fn()
    const m = { getTracks: () => [{ stop }] }
    const p = await createVoicePipeline(m, { noiseSuppression: false }, deps)
    p.close()
    expect(stop).toHaveBeenCalled()
    expect(SahteAudioContext.son.close).toHaveBeenCalled()
  })

  it('engelleme kapatılınca RNNoise atlanır, açılınca geri girer', async () => {
    const r = sahteDugum()
    const p = await createVoicePipeline(mic, { noiseSuppression: true }, { ...deps, createRnnoise: async () => r })
    expect(r.connect).toHaveBeenCalled()
    r.connect.mockClear()
    p.setNoiseSuppression(false)
    expect(r.disconnect).toHaveBeenCalled()
    expect(r.connect).not.toHaveBeenCalled()
    p.setNoiseSuppression(true)
    expect(r.connect).toHaveBeenCalled()
  })

  it('RNNoise kurulumu başarısız olursa mikrofon durur, bağlam kapanır, hata yeniden fırlar', async () => {
    const stop = vi.fn()
    const m = { getTracks: () => [{ stop }] }
    const hata = new Error('wasm yok')
    await expect(
      createVoicePipeline(m, { noiseSuppression: true }, { ...deps, createRnnoise: async () => { throw hata } }),
    ).rejects.toBe(hata)
    expect(stop).toHaveBeenCalled()
    expect(SahteAudioContext.son.close).toHaveBeenCalled()
  })

  it('askıya alınmış bağlam resume ile uyandırılır', async () => {
    class Askida extends SahteAudioContext {
      constructor(o) { super(o); this.state = 'suspended'; this.resume = vi.fn(async () => {}) }
    }
    await createVoicePipeline(mic, { noiseSuppression: true }, { ...deps, AudioContext: Askida })
    expect(SahteAudioContext.son.resume).toHaveBeenCalled()
  })
})
