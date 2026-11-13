// @vitest-environment jsdom
// Sesli oturum (mikrofon + ses hattı + örgü + hoparlör) ve alt ses paneli.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }))

import { createVoiceSession } from '../src/voice/session.js'
import { getSettings, updateSettings } from '../src/settings.js'
import { renderVoicePanel, renderMuteButtons, VOICE_STATUS_TEXT } from '../src/ui/voicePanel.js'
import { MicError, MIC_MESSAGES } from '../src/voice/pipeline.js'
import { fakeStream, createNet, createBus, fakeLevelMeter } from './fakes/webrtc.js'
import { PeerMesh } from '../src/voice/mesh.js'

// Sahte örgü: olayları test elle tetikler
class FakeMesh {
  constructor(opts) {
    this.opts = opts
    this.dinleyiciler = {}
    this.deafened = false
    this.joined = false
    this.left = false
    this.bitrate = null
    this.reconnects = 0
    FakeMesh.son = this
  }
  on(ad, cb) { (this.dinleyiciler[ad] ??= []).push(cb); return () => {} }
  emit(ad, veri) { for (const cb of this.dinleyiciler[ad] ?? []) cb(veri) }
  join() { this.joined = true }
  leave() { this.left = true }
  setDeafened(b) { this.deafened = b }
  setBitrate(k) { this.bitrate = k; return k }
  reconnect() { this.reconnects++ }
  failedPeerCount() { return this.basarisiz ?? 0 }
}

// Sahte ses hattı
function fakeHat() {
  return {
    outputStream: fakeStream('hat'),
    gate: true,
    level: 0,
    closed: false,
    ns: null,
    setGate(a) { this.gate = a },
    getLevel() { return this.level },
    setNoiseSuppression(a) { this.ns = a },
    close() { this.closed = true },
  }
}

let hat, sesler, mik
function oturumKur({ micHatasi = null } = {}) {
  hat = fakeHat()
  sesler = []
  return createVoiceSession({
    channelId: 'v1',
    userId: 'ben',
    deps: {
      openMic: async () => { if (micHatasi) throw micHatasi; mik = fakeStream('mik'); return mik },
      createVoicePipeline: async () => hat,
      createMesh: (opts) => new FakeMesh(opts),
      playBeep: (ad) => sesler.push(ad),
      getNoiseSuppressionPref: () => true,
    },
  })
}
const sesElemanlari = () => [...document.querySelectorAll('audio')]

beforeEach(() => {
  document.body.innerHTML = ''
  FakeMesh.son = null
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
})
afterEach(() => vi.useRealTimers())

describe('sesli oturum', () => {
  it('kayıtlı mikrofon çıkarılmışsa varsayılana döner ve eski seçimi unutur', async () => {
    localStorage.clear()
    updateSettings({ inputDeviceId: 'eski-cihaz' })
    hat = fakeHat()
    const cagrilar = []
    const o = createVoiceSession({
      channelId: 'v1',
      userId: 'ben',
      deps: {
        openMic: async (id) => {
          cagrilar.push(id)
          if (id) throw new MicError('no-mic', MIC_MESSAGES['no-mic'])
          return fakeStream('mik')
        },
        createVoicePipeline: async () => hat,
        createMesh: (opts) => new FakeMesh(opts),
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    await o.join()
    expect(cagrilar).toEqual(['eski-cihaz', undefined])
    expect(o.getState().listenOnly).toBe(false)
    expect(getSettings().inputDeviceId).toBeNull()
    o.leave()
  })

  it('katılınca örgü voice kanalına, hattın çıkış akışıyla katılır; bip çalar', async () => {
    const o = oturumKur()
    expect(o.getState().status).toBe('connecting')
    await o.join()
    const m = FakeMesh.son
    expect(m.joined).toBe(true)
    expect(m.opts.channelId).toBe('v1')
    expect(m.opts.userId).toBe('ben')
    expect(m.opts.localStream).toBe(hat.outputStream)
    expect(m.opts.iceServers.length).toBeGreaterThan(0)
    expect(sesler).toEqual(['join'])
    expect(hat.gate).toBe(true) // varsayılan: konuşabilir
    m.emit('ready')
    expect(o.getState().status).toBe('connected')
    o.leave()
  })

  it('hiç bağlantı kurulamazsa connect-failed; arayüzde "Doğrudan bağlantı kurulamadı" yazar', async () => {
    const o = oturumKur()
    await o.join()
    FakeMesh.son.emit('ready')
    FakeMesh.son.basarisiz = 1
    FakeMesh.son.emit('connect-failed', { userId: 'x' })
    FakeMesh.son.emit('failed-change')
    expect(o.getState().status).toBe('failed')
    const panel = renderVoicePanel({ channelName: 'Lobi', state: o.getState(), handlers: {} })
    expect(panel.textContent).toContain('Doğrudan bağlantı kurulamadı')
    expect(VOICE_STATUS_TEXT.failed).toBe('Doğrudan bağlantı kurulamadı')
    // Başka biriyle bağlanmak yetmez: x hâlâ bağlanamıyor
    FakeMesh.son.emit('peer-joined', { userId: 'y', stream: fakeStream('y') })
    expect(o.getState().status).toBe('failed')
    // x ile de bağlantı kurulunca (yeniden deneme başarılı) yazı kalkar
    FakeMesh.son.basarisiz = 0
    FakeMesh.son.emit('failed-change')
    expect(o.getState().status).toBe('connected')
    o.leave()
  })

  it('mikrofon izni yoksa sadece dinleyici olarak katılır ve Türkçe hatayı gösterir', async () => {
    const o = oturumKur({ micHatasi: new MicError('denied', MIC_MESSAGES.denied) })
    await o.join()
    const s = o.getState()
    expect(FakeMesh.son.joined).toBe(true)
    expect(FakeMesh.son.opts.localStream).toBeNull()
    expect(s.muted).toBe(true)
    expect(s.micError).toBe('Mikrofon izni verilmedi')
    o.setMuted(false) // mikrofon yokken susturma kaldırılamaz
    expect(o.getState().muted).toBe(true)
    const panel = renderVoicePanel({ channelName: 'Lobi', state: o.getState(), handlers: {} })
    expect(panel.textContent).toContain('Mikrofon izni verilmedi')
    // Sustur kullanıcı çubuğunda: mikrofon yokken pasif
    expect(renderMuteButtons(o.getState())[0].getAttribute('aria-disabled')).toBe('true')
    o.leave()
  })

  it('gelen ses için gizli audio oluşturulur, ayrılınca kaldırılır', async () => {
    const o = oturumKur()
    await o.join()
    const akis = fakeStream('uzak')
    FakeMesh.son.emit('peer-joined', { userId: 'y', stream: akis })
    expect(sesElemanlari()).toHaveLength(1)
    const a = sesElemanlari()[0]
    expect(a.srcObject).toBe(akis)
    expect(a.autoplay).toBe(true)
    expect(a.hidden).toBe(true)
    expect(a.play).toHaveBeenCalled()
    FakeMesh.son.emit('peer-left', { userId: 'y' })
    expect(sesElemanlari()).toHaveLength(0)
    FakeMesh.son.emit('peer-joined', { userId: 'z', stream: fakeStream('z') })
    o.leave()
    expect(sesElemanlari()).toHaveLength(0)
    expect(FakeMesh.son.left).toBe(true)
    expect(hat.closed).toBe(true)
    expect(sesler).toEqual(['join', 'leave'])
  })

  it('sağırlaştırma: hoparlörler ve örgü susar, mikrofon kapısı kapanır; kaldırınca geri gelir', async () => {
    const o = oturumKur()
    await o.join()
    FakeMesh.son.emit('peer-joined', { userId: 'y', stream: fakeStream('y') })
    o.setDeafened(true)
    expect(sesElemanlari()[0].muted).toBe(true)
    expect(FakeMesh.son.deafened).toBe(true)
    expect(hat.gate).toBe(false)
    // Sağırken gelen yeni eş de sessiz başlar
    FakeMesh.son.emit('peer-joined', { userId: 'z', stream: fakeStream('z') })
    expect(sesElemanlari()[1].muted).toBe(true)
    o.setDeafened(false)
    expect(sesElemanlari().every((a) => !a.muted)).toBe(true)
    expect(FakeMesh.son.deafened).toBe(false)
    expect(hat.gate).toBe(true)
    o.leave()
  })

  it('kapı = konuşma izni (Görev 8) VE susturulmamış', async () => {
    const o = oturumKur()
    await o.join()
    o.setMuted(true)
    expect(hat.gate).toBe(false)
    o.setMuted(false)
    expect(hat.gate).toBe(true)
    o.setTransmitting(false)
    expect(hat.gate).toBe(false)
    o.setTransmitting(true)
    o.setMuted(true)
    expect(hat.gate).toBe(false)
    o.leave()
  })

  it('setBitrate 32–128 aralığına sıkıştırılıp örgüye iletilir', async () => {
    const o = oturumKur()
    await o.join()
    expect(o.setBitrate(999)).toBe(128)
    expect(FakeMesh.son.bitrate).toBe(128)
    expect(o.setBitrate(1)).toBe(32)
    o.leave()
  })

  it('konuşanlar: eşlerden gelen olay + kendi seviyemiz (100 ms)', async () => {
    vi.useFakeTimers()
    const o = oturumKur()
    await o.join()
    const degisimler = []
    o.on('speaking', (set) => degisimler.push([...set].sort()))
    FakeMesh.son.emit('peer-speaking', { userId: 'y', speaking: true })
    expect([...o.getState().speaking]).toEqual(['y'])
    hat.level = 0.5
    await vi.advanceTimersByTimeAsync(100)
    expect([...o.getState().speaking].sort()).toEqual(['ben', 'y'])
    // Susturulunca kendi halkamız söner
    o.setMuted(true)
    await vi.advanceTimersByTimeAsync(100)
    expect([...o.getState().speaking]).toEqual(['y'])
    FakeMesh.son.emit('peer-left', { userId: 'y' })
    expect(o.getState().speaking.size).toBe(0)
    expect(degisimler.length).toBeGreaterThan(0)
    o.leave()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('internet geri gelince örgü yeniden bağlanır', async () => {
    const o = oturumKur()
    await o.join()
    window.dispatchEvent(new Event('online'))
    expect(FakeMesh.son.reconnects).toBe(1)
    o.leave()
    window.dispatchEvent(new Event('online'))
    expect(FakeMesh.son.reconnects).toBe(1) // ayrıldıktan sonra dinlemiyor
  })

  it('mikrofon açılırken ayrılırsa hiçbir şey kalmaz', async () => {
    const o = oturumKur()
    const p = o.join()
    o.leave()
    await p
    expect(mik.getTracks()[0].stopped).toBe(true) // mikrofon ışığı sönük kalır
    expect(FakeMesh.son).toBeNull() // örgü hiç kurulmadı
    expect(sesler).toEqual([])
  })
})

describe('ses paneli', () => {
  const durum = (ek = {}) => ({ status: 'connecting', micError: null, muted: false, deafened: false, listenOnly: false, speaking: new Set(), ...ek })

  it('kanal adı, durum ve Ayrıl; Sustur / Sağırlaştır çubuk düğmeleri', () => {
    const tik = []
    const handlers = { onToggleMute: () => tik.push('m'), onToggleDeafen: () => tik.push('d'), onLeave: () => tik.push('l') }
    const p = renderVoicePanel({ channelName: 'Lobi', state: durum(), handlers })
    expect(p.textContent).toContain('Lobi')
    expect(p.textContent).toContain('Bağlanıyor…')
    const [sustur, sagir] = renderMuteButtons(durum(), handlers)
    sustur.click()
    sagir.click()
    ;[...p.querySelectorAll('button')].find((b) => b.dataset.ad === 'Ayrıl').click()
    expect(tik).toEqual(['m', 'd', 'l'])
  })

  it('Bağlandı ve basılı düğmeler', () => {
    const p = renderVoicePanel({ channelName: 'Lobi', state: durum({ status: 'connected', muted: true, deafened: true }), handlers: {} })
    expect(p.textContent).toContain('Ses bağlandı')
    const [sustur, sagir] = renderMuteButtons(durum({ muted: true, deafened: true }))
    expect(sustur.getAttribute('aria-pressed')).toBe('true')
    expect(sagir.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('başlangıç susturma tercihi (U01)', () => {
  it('muted / deafened ile kurulan oturum öyle başlar; kapı kapalı, örgü sağır', async () => {
    hat = fakeHat()
    const o = createVoiceSession({
      channelId: 'v1', userId: 'ben', muted: true, deafened: true,
      deps: {
        openMic: async () => fakeStream('mik'),
        createVoicePipeline: async () => hat,
        createMesh: (opts) => new FakeMesh(opts),
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    expect(o.getState()).toMatchObject({ muted: true, deafened: true })
    await o.join()
    expect(hat.gate).toBe(false)
    expect(FakeMesh.son.deafened).toBe(true)
    o.setMuted(false)
    o.setDeafened(false)
    expect(hat.gate).toBe(true) // formül aynı: konuşma izni VE susturulmamış VE sağır değil
    o.leave()
  })
})

describe('sinyal konusu (DM araması)', () => {
  it('topic verilmezse örgüye voice:<kanal> gider; verilirse o konu', async () => {
    const o = oturumKur()
    expect(o.topic).toBe('voice:v1')
    await o.join()
    expect(FakeMesh.son.opts.topic).toBe('voice:v1')
    o.leave()
    const a = createVoiceSession({
      channelId: 'arama1',
      topic: 'dm-voice:arama1',
      userId: 'ben',
      deps: {
        openMic: async () => fakeStream('mik'),
        createVoicePipeline: async () => fakeHat(),
        createMesh: (opts) => new FakeMesh(opts),
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    expect(a.topic).toBe('dm-voice:arama1')
    await a.join()
    expect(FakeMesh.son.opts.topic).toBe('dm-voice:arama1')
    expect(FakeMesh.son.opts.channelId).toBe('arama1')
    a.leave()
  })

  it('arama biterken (leave) dm-voice: kanalı bırakılır, mikrofon/hat kapanır, sayaç kalmaz', async () => {
    vi.useFakeTimers()
    const net = createNet()
    const bus = createBus()
    const h = fakeHat()
    let mikrofon = null
    const o = createVoiceSession({
      channelId: 'arama1',
      topic: 'dm-voice:arama1',
      userId: 'ben',
      deps: {
        openMic: async () => { mikrofon = fakeStream('mik'); return mikrofon },
        createVoicePipeline: async () => h,
        createMesh: (opts) => new PeerMesh(opts, { RTCPeerConnection: net.RTCPeerConnection, createLevelMeter: fakeLevelMeter }),
        signal: bus.signal,
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    await o.join()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(bus.subs.map((s) => s.topic)).toEqual(['dm-voice:arama1'])
    expect(bus.subs[0].open).toBe(true)
    expect(vi.getTimerCount()).toBeGreaterThan(0) // konuşan halkası ve örgü sayaçları
    o.leave()
    expect(bus.subs[0].open).toBe(false) // realtime kanalı bırakıldı
    expect(bus.sent.at(-1)).toEqual({ topic: 'dm-voice:arama1', msg: expect.objectContaining({ type: 'bye' }) })
    expect(h.closed).toBe(true) // ses hattı (mikrofon izi onun içinde) kapandı
    expect(vi.getTimerCount()).toBe(0) // sayaç/zamanlayıcı kalmadı
  })

  it('mikrofon açılırken leave gelirse mikrofon izi durur (iki kez açık kalmaz)', async () => {
    let bitir
    const mikrofon = fakeStream('mik')
    const o = createVoiceSession({
      channelId: 'arama1',
      topic: 'dm-voice:arama1',
      userId: 'ben',
      deps: {
        openMic: () => new Promise((r) => { bitir = () => r(mikrofon) }),
        createVoicePipeline: async () => fakeHat(),
        createMesh: (opts) => new FakeMesh(opts),
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
    const katilma = o.join()
    o.leave()
    bitir()
    await katilma
    expect(mikrofon.getTracks()[0].stopped).toBe(true)
    expect(FakeMesh.son).toBeNull()
  })
})

describe('karşının susturma durumu (shareState, DM araması)', () => {
  function aramaOturumu(shareState) {
    return createVoiceSession({
      channelId: 'arama1',
      topic: 'dm-voice:arama1',
      userId: 'ben',
      shareState,
      deps: {
        openMic: async () => fakeStream('mik'),
        createVoicePipeline: async () => fakeHat(),
        createMesh: (opts) => {
          const m = new FakeMesh(opts)
          m.gonderilen = []
          m.sendState = (s) => m.gonderilen.push(s)
          return m
        },
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
      },
    })
  }

  it('durumumuz hazır olunca, eş bağlanınca ve değişince gönderilir; karşınınki getPeerState ile okunur', async () => {
    const o = aramaOturumu(true)
    await o.join()
    const m = FakeMesh.son
    m.emit('ready')
    m.emit('peer-joined', { userId: 'o', stream: fakeStream('o') })
    o.setMuted(true)
    o.setDeafened(true)
    expect(m.gonderilen).toEqual([
      { muted: false, deafened: false },
      { muted: false, deafened: false },
      { muted: true, deafened: false },
      { muted: true, deafened: true },
    ])
    expect(o.connectedPeers()).toEqual(['o'])
    const degisim = vi.fn()
    o.on('change', degisim)
    expect(o.getPeerState('o')).toBeNull()
    m.emit('peer-state', { userId: 'o', muted: true, deafened: false })
    expect(o.getPeerState('o')).toEqual({ muted: true, deafened: false })
    expect(degisim).toHaveBeenCalled()
    m.emit('peer-left', { userId: 'o' })
    expect(o.getPeerState('o')).toBeNull()
    expect(o.connectedPeers()).toEqual([])
    o.leave()
  })

  it('shareState kapalıyken (sesli kanal) durum gönderilmez, karşınınki dinlenmez', async () => {
    const o = aramaOturumu(false)
    await o.join()
    const m = FakeMesh.son
    m.emit('ready')
    o.setMuted(true)
    expect(m.gonderilen).toEqual([])
    expect(m.dinleyiciler['peer-state']).toBeUndefined()
    o.leave()
  })
})
