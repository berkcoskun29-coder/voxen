// @vitest-environment jsdom
// Ekran paylaşımı: startScreenShare, oturumda aç/kapa, presence, ayarlar, ses paneli düğmesi, ekran sesi m-satırı.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }))

import { startScreenShare, SCREEN_HEADPHONE_WARNING, screenShareSupported, desktopScreenNotice } from '../src/voice/screenShare.js'
import { createVoiceSession } from '../src/voice/session.js'
import { getSettings, updateSettings, DEFAULTS } from '../src/settings.js'
import { renderVoicePanel } from '../src/ui/voicePanel.js'
import { PeerMesh } from '../src/voice/mesh.js'
import { fakeStream } from './fakes/webrtc.js'

function sahteIz(kind) {
  const olaylar = {}
  return {
    kind, contentHint: '', stopped: false,
    stop() { this.stopped = true },
    addEventListener(ad, f) { olaylar[ad] = f },
    bitir() { olaylar.ended?.() },
  }
}
function sahteMedya(getDisplayMedia) {
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
}

describe('startScreenShare', () => {
  it('Net: 1920x1080/30, ses ve ekran sesi ayarları, contentHint detail', async () => {
    const v = sahteIz('video'); const a = sahteIz('audio')
    const gdm = vi.fn(async () => ({ getVideoTracks: () => [v], getAudioTracks: () => [a] }))
    sahteMedya(gdm)
    const r = await startScreenShare({ mode: 'net' })
    expect(gdm).toHaveBeenCalledWith({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: { restrictOwnAudio: true },
      systemAudio: 'include',
    })
    // suppressLocalAudioPlayback paylaşanın kendi sekmesini/oyununu sessize alıyordu: hiçbir yerde olmamalı
    expect(JSON.stringify(gdm.mock.calls[0][0])).not.toContain('suppressLocalAudioPlayback')
    expect(r.video).toBe(v)
    expect(r.audio).toBe(a)
    expect(v.contentHint).toBe('detail')
  })
  it('Akıcı: 1280x720/60', async () => {
    const gdm = vi.fn(async () => ({ getVideoTracks: () => [sahteIz('video')], getAudioTracks: () => [] }))
    sahteMedya(gdm)
    await startScreenShare({ mode: 'akici' })
    expect(gdm.mock.calls[0][0].video).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } })
  })
  it('ses izi yoksa audio null; stop() hepsini durdurur', async () => {
    const v = sahteIz('video')
    sahteMedya(async () => ({ getVideoTracks: () => [v], getAudioTracks: () => [] }))
    const r = await startScreenShare({ mode: 'net' })
    expect(r.audio).toBeNull()
    r.stop()
    expect(v.stopped).toBe(true)
  })
  it('seçici iptali -> code cancelled', async () => {
    for (const ad of ['NotAllowedError', 'AbortError']) {
      sahteMedya(async () => { throw Object.assign(new Error('x'), { name: ad }) })
      await expect(startScreenShare({ mode: 'net' })).rejects.toMatchObject({ code: 'cancelled' })
    }
  })
  it('destek denetimi', () => {
    sahteMedya(async () => {})
    expect(screenShareSupported()).toBe(true)
    vi.stubGlobal('navigator', { mediaDevices: {} })
    expect(screenShareSupported()).toBe(false)
  })
})

// --- oturum ---
class FakeMesh {
  constructor(opts) { this.opts = opts; this.izlar = []; FakeMesh.son = this }
  on() { return () => {} }
  join() {}
  leave() {}
  setDeafened() {}
  setBitrate() {}
  setUploadMbps() {}
  failedPeerCount() { return 0 }
  async setLocalTrack(slot, iz) { this.izlar.push([slot, iz]) }
}
let cagrilar
function oturumKur({ ses = true, hata = null } = {}) {
  cagrilar = []
  return createVoiceSession({
    channelId: 'v1', userId: 'ben',
    deps: {
      openMic: async () => fakeStream('mik'),
      createVoicePipeline: async () => ({ outputStream: fakeStream('hat'), setGate() {}, getLevel: () => 0, close() {} }),
      createMesh: (o) => new FakeMesh(o),
      playBeep: () => {},
      getNoiseSuppressionPref: () => true,
      startScreenShare: async ({ mode }) => {
        if (hata) throw hata
        const r = { mode, video: sahteIz('video'), audio: ses ? sahteIz('audio') : null, stop() { this.video.stop(); this.audio?.stop() } }
        cagrilar.push(r)
        return r
      },
    },
  })
}
const iptal = () => Object.assign(new Error('iptal'), { code: 'cancelled' })

beforeEach(() => { localStorage.clear(); FakeMesh.son = null })

describe('oturumda ekran paylaşımı', () => {
  it('aç: ekran + ekran sesi yuvalara takılır, state.screen true, mod geçer', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true, 'akici')
    const r = cagrilar[0]
    expect(r.mode).toBe('akici')
    expect(FakeMesh.son.izlar).toEqual([['screen', r.video], ['screenAudio', r.audio]])
    expect(o.getState().screen).toBe(true)
  })
  it('mod verilmezse ayarlardaki screenMode kullanılır (varsayılan net)', async () => {
    expect(DEFAULTS.screenMode).toBe('net')
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    expect(cagrilar[0].mode).toBe('net')
  })
  it('ses izi yoksa screenAudio yuvası null kalır, uyarı yok', async () => {
    const o = oturumKur({ ses: false })
    await o.join()
    const nots = vi.fn()
    o.on('notice', nots)
    await o.setScreenShare(true)
    expect(FakeMesh.son.izlar).toEqual([['screen', cagrilar[0].video], ['screenAudio', null]])
    expect(nots).not.toHaveBeenCalled()
  })
  it('ses geldiyse kulaklık uyarısı her paylaşımda bir kez', async () => {
    const o = oturumKur()
    await o.join()
    const nots = vi.fn()
    o.on('notice', nots)
    await o.setScreenShare(true)
    expect(nots).toHaveBeenCalledTimes(1)
    expect(nots).toHaveBeenCalledWith('Ekran sesi paylaşırken kulaklık kullan, yoksa arkadaşların kendini duyabilir')
    expect(SCREEN_HEADPHONE_WARNING).toBe(nots.mock.calls[0][0])
    await o.setScreenShare(false)
    await o.setScreenShare(true)
    expect(nots).toHaveBeenCalledTimes(2)
  })
  it('kapat: izler durur, iki yuva null', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    await o.setScreenShare(false)
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
    expect(FakeMesh.son.izlar.slice(-2)).toEqual([['screen', null], ['screenAudio', null]])
    expect(o.getState().screen).toBe(false)
  })
  it('ended (sistemden durdurma): ikisi de durur, yuvalar null, state.screen false, change yayılır', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    const degisim = vi.fn()
    o.on('change', degisim)
    cagrilar[0].video.bitir()
    await o.setScreenShare(false) // aynı kuyruğa girer: ended işlenmiş olur
    expect(o.getState().screen).toBe(false)
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
    expect(FakeMesh.son.izlar.slice(-2)).toEqual([['screen', null], ['screenAudio', null]])
    expect(degisim).toHaveBeenCalled()
  })
  it('seçici iptali sessiz: hata yok, kapalı kalır', async () => {
    const o = oturumKur({ hata: iptal() })
    await o.join()
    await o.setScreenShare(true)
    expect(o.getState().screen).toBe(false)
    expect(o.getState().screenError).toBeNull()
    expect(FakeMesh.son.izlar).toEqual([])
  })
  it('başka hata: Türkçe screenError', async () => {
    const o = oturumKur({ hata: new Error('patladı') })
    await o.join()
    await o.setScreenShare(true)
    expect(o.getState().screen).toBe(false)
    expect(o.getState().screenError).toBe('Ekran paylaşımı başlatılamadı')
  })
  it('art arda iki aç: yalnız bir paylaşım', async () => {
    const o = oturumKur()
    await o.join()
    await Promise.all([o.setScreenShare(true), o.setScreenShare(true)])
    expect(cagrilar.length).toBe(1)
  })
  it('açılırken gelen kapat: sonuç kapalı, izler durmuş', async () => {
    const o = oturumKur()
    await o.join()
    await Promise.all([o.setScreenShare(true), o.setScreenShare(false)])
    expect(o.getState().screen).toBe(false)
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
  })
  it('örgüye takma başarısızsa izler durur, açık sayılmaz', async () => {
    const o = oturumKur()
    await o.join()
    FakeMesh.son.setLocalTrack = async (slot, iz) => { if (iz) throw new Error('takılamadı') }
    await o.setScreenShare(true)
    expect(o.getState().screen).toBe(false)
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
    expect(o.getState().screenError).toBe('Ekran paylaşımı başlatılamadı')
  })
  it('yalnız ses izi ended: screenAudio yuvası null, video sürer', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    cagrilar[0].audio.bitir()
    await o.setScreenShare(true) // kuyruğu boşaltır (zaten açık: işlem yok)
    expect(FakeMesh.son.izlar.at(-1)).toEqual(['screenAudio', null])
    expect(o.getState().screen).toBe(true)
  })
  it('ekranKapat: screen null atması reddedilse de screenAudio temizlenir, izler durur', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    const eski = FakeMesh.son.setLocalTrack.bind(FakeMesh.son)
    FakeMesh.son.setLocalTrack = async (slot, iz) => { await eski(slot, iz); if (slot === 'screen') throw new Error('x') }
    await o.setScreenShare(false).catch(() => {})
    expect(FakeMesh.son.izlar.at(-1)).toEqual(['screenAudio', null])
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
    expect(o.getState().screen).toBe(false)
  })
  it('başlarken ayrılınca: izler durur, yuva atanmaz', async () => {
    let birak
    const o = createVoiceSession({
      channelId: 'v1', userId: 'ben',
      deps: {
        openMic: async () => fakeStream('mik'),
        createVoicePipeline: async () => ({ outputStream: fakeStream('hat'), setGate() {}, getLevel: () => 0, close() {} }),
        createMesh: (op) => new FakeMesh(op),
        playBeep: () => {},
        getNoiseSuppressionPref: () => true,
        startScreenShare: () => new Promise((coz) => { birak = coz }),
      },
    })
    await o.join()
    const bekle = o.setScreenShare(true)
    await Promise.resolve()
    o.leave()
    const r = { video: sahteIz('video'), audio: sahteIz('audio'), stop() { this.video.stop(); this.audio.stop() } }
    birak(r)
    await bekle
    expect(r.video.stopped).toBe(true)
    expect(r.audio.stopped).toBe(true)
    expect(FakeMesh.son.izlar).toEqual([])
  })
  it('ayrılınca paylaşım durur', async () => {
    const o = oturumKur()
    await o.join()
    await o.setScreenShare(true)
    o.leave()
    expect(cagrilar[0].video.stopped).toBe(true)
    expect(cagrilar[0].audio.stopped).toBe(true)
    expect(o.getState().screen).toBe(false)
  })
})

describe('ayarlar, presence, panel', () => {
  it('screenMode varsayılan net, geçersiz değer net olur', () => {
    expect(getSettings().screenMode).toBe('net')
    updateSettings({ screenMode: 'akici' })
    expect(getSettings().screenMode).toBe('akici')
    updateSettings({ screenMode: 'saçma' })
    expect(getSettings().screenMode).toBe('net')
  })
  const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, camera: false, screen: false, ...ek })
  it('🖥 düğmesi: aria, aktifken yeşil/aria değişir, tıklayınca onToggleScreen', () => {
    sahteMedya(async () => {})
    const onToggleScreen = vi.fn()
    let kutu = renderVoicePanel({ channelName: 'k', state: durum(), handlers: { onToggleScreen } })
    let b = kutu.querySelector('.screen-btn')
    expect(b.getAttribute('aria-label')).toBe('Ekranı paylaş')
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.classList.contains('active')).toBe(false)
    b.click()
    expect(onToggleScreen).toHaveBeenCalled()
    kutu = renderVoicePanel({ channelName: 'k', state: durum({ screen: true }), handlers: {} })
    b = kutu.querySelector('.screen-btn')
    expect(b.getAttribute('aria-label')).toBe('Paylaşımı durdur')
    expect(b.classList.contains('active')).toBe(true)
  })
  it('bağlanırken (status connecting) 🖥 düğmesi kapalı (disabled)', () => {
    sahteMedya(async () => {})
    const b = (st) => renderVoicePanel({ channelName: 'k', state: durum(st), handlers: {} }).querySelector('.screen-btn')
    expect(b({ status: 'connecting' }).getAttribute('aria-disabled')).toBe('true')
    expect(b({ status: 'connected' }).getAttribute('aria-disabled')).toBeNull()
  })
  it('örgü kurulmadan setScreenShare(true): paylaşım başlamaz ama change yayılır', async () => {
    const o = oturumKur()
    const degisim = vi.fn()
    o.on('change', degisim)
    await o.setScreenShare(true)
    expect(o.getState().screen).toBe(false)
    expect(degisim).toHaveBeenCalled()
  })
  it('getDisplayMedia yoksa düğme gizli', () => {
    vi.stubGlobal('navigator', { mediaDevices: {} })
    const kutu = renderVoicePanel({ channelName: 'k', state: durum(), handlers: {} })
    expect(kutu.querySelector('.screen-btn')).toBeNull()
  })
  it('screenError panelde gösterilir', () => {
    sahteMedya(async () => {})
    const kutu = renderVoicePanel({ channelName: 'k', state: durum({ screenError: 'Ekran paylaşımı başlatılamadı' }), handlers: {} })
    expect(kutu.querySelector('.voice-error').textContent).toBe('Ekran paylaşımı başlatılamadı')
  })
})

describe('ekran sesi m-satırı', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:2',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=mid:3', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', '',
  ].join('\r\n')
  it('mikrofon satırı mono ayarlı; ekran sesi satırı stereo 128 kbps', () => {
    const m = Object.create(PeerMesh.prototype)
    m.bitrateKbps = 64
    const son = m._opusAyarla(sdp)
    const i = son.indexOf('a=mid:3')
    const mik = son.slice(0, son.indexOf('m=video'))
    const ekran = son.slice(i)
    expect(mik).toContain('stereo=0')
    expect(mik).toContain('maxaveragebitrate=64000')
    expect(ekran).toContain('stereo=1')
    expect(ekran).toContain('maxaveragebitrate=128000')
  })
})

// --- Masaüstü (Tauri/WebView2): ekran paylaşımı yoksa 🖥 düğmesi sessizce kaybolmaz, ne yapılacağını söyler ---
describe('masaüstünde ekran paylaşımı desteklenmiyorsa', () => {
  const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, camera: false, screen: false, ...ek })
  const NOT = 'Bu özellik şimdilik tarayıcı sürümünde: voxen-sohbet.netlify.app'
  beforeEach(() => { window.__TAURI_INTERNALS__ = {} })
  afterEach(() => { delete window.__TAURI_INTERNALS__ })

  it('uyarı metni web adresini (https:// olmadan) içerir; adres yoksa yalnız cümle', () => {
    expect(desktopScreenNotice('https://voxen-sohbet.netlify.app')).toBe(NOT)
    expect(desktopScreenNotice('https://voxen-sohbet.netlify.app/')).toBe(NOT)
    expect(desktopScreenNotice('')).toBe('Bu özellik şimdilik tarayıcı sürümünde')
  })
  it('getDisplayMedia yoksa 🖥 görünür ama kapalıdır; ipucu uyarıdır, tıklayınca uyarı panelde çıkar', () => {
    vi.stubGlobal('navigator', { mediaDevices: {} })
    const onToggleScreen = vi.fn()
    const kutu = renderVoicePanel({ channelName: 'k', state: durum(), handlers: { onToggleScreen } })
    const b = kutu.querySelector('.screen-btn')
    expect(b).not.toBeNull()
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.title).toBe(desktopScreenNotice())
    expect(kutu.querySelector('.screen-notice')).toBeNull()
    b.click()
    expect(onToggleScreen).not.toHaveBeenCalled()
    expect(kutu.querySelector('.screen-notice').textContent).toBe(desktopScreenNotice())
  })
  it('getDisplayMedia varsa masaüstünde de normal düğme', () => {
    sahteMedya(async () => {})
    const onToggleScreen = vi.fn()
    const b = renderVoicePanel({ channelName: 'k', state: durum(), handlers: { onToggleScreen } }).querySelector('.screen-btn')
    expect(b.getAttribute('aria-disabled')).toBeNull()
    b.click()
    expect(onToggleScreen).toHaveBeenCalled()
  })
  it('getDisplayMedia NotSupportedError verirse: code unsupported, mesaj uyarı', async () => {
    sahteMedya(async () => { throw Object.assign(new Error('x'), { name: 'NotSupportedError' }) })
    await expect(startScreenShare()).rejects.toMatchObject({ code: 'unsupported', message: desktopScreenNotice() })
  })
  it('web sürümünde NotSupportedError olduğu gibi fırlar', async () => {
    delete window.__TAURI_INTERNALS__
    sahteMedya(async () => { throw Object.assign(new Error('x'), { name: 'NotSupportedError' }) })
    await expect(startScreenShare()).rejects.toMatchObject({ name: 'NotSupportedError' })
  })
  it('oturum: unsupported hatası screenError olarak uyarı metnini gösterir', async () => {
    const o = oturumKur({ hata: Object.assign(new Error(NOT), { code: 'unsupported' }) })
    await o.join()
    await o.setScreenShare(true)
    expect(o.getState().screenError).toBe(NOT)
  })
})
