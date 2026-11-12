// @vitest-environment jsdom
// Kamera: openCamera, oturumda aç/kapa, presence, ayarlar, ses paneli düğmesi.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn() } }))

import { openCamera, CameraError, CAMERA_MESSAGES } from '../src/voice/camera.js'
import { createVoiceSession } from '../src/voice/session.js'
import { getSettings, updateSettings, DEFAULTS } from '../src/settings.js'
import { renderVoicePanel } from '../src/ui/voicePanel.js'
import { fakeStream } from './fakes/webrtc.js'

// --- openCamera ---
function sahteMedya(getUserMedia) {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
}
function sahteIz() {
  return { kind: 'video', contentHint: '', stopped: false, stop() { this.stopped = true }, addEventListener() {} }
}

describe('openCamera', () => {
  it('1280x720/30 ister, contentHint motion koyar, izi döner', async () => {
    const iz = sahteIz()
    const gum = vi.fn(async () => ({ getVideoTracks: () => [iz] }))
    sahteMedya(gum)
    expect(await openCamera('cam1')).toBe(iz)
    const { video } = gum.mock.calls[0][0]
    expect(video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, deviceId: { exact: 'cam1' } })
    expect(iz.contentHint).toBe('motion')
  })
  it('izin reddi -> CameraError denied, Türkçe metin', async () => {
    sahteMedya(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) })
    await expect(openCamera()).rejects.toMatchObject({ name: 'CameraError', code: 'denied', message: 'Kamera izni verilmedi' })
  })
  it('kamera yok -> CameraError no-camera', async () => {
    sahteMedya(async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }) })
    const e = await openCamera().catch((x) => x)
    expect(e).toBeInstanceOf(CameraError)
    expect(e.code).toBe('no-camera')
    expect(CAMERA_MESSAGES['no-camera']).toBe('Kamera bulunamadı')
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
  setRoomScreenOn(b) { this.odadaEkran = b }
  failedPeerCount() { return 0 }
  async setLocalTrack(slot, iz) { this.izlar.push([slot, iz]) }
}
let izlar
function oturumKur({ kameraHatasi = null, kameraAc } = {}) {
  izlar = []
  return createVoiceSession({
    channelId: 'v1',
    userId: 'ben',
    deps: {
      openMic: async () => fakeStream('mik'),
      createVoicePipeline: async () => ({ outputStream: fakeStream('hat'), setGate() {}, getLevel: () => 0, close() {} }),
      createMesh: (o) => new FakeMesh(o),
      playBeep: () => {},
      getNoiseSuppressionPref: () => true,
      openCamera: kameraAc ?? (async () => { if (kameraHatasi) throw kameraHatasi; const iz = sahteIz(); izlar.push(iz); return iz }),
    },
  })
}

beforeEach(() => { localStorage.clear(); FakeMesh.son = null })

describe('oturumda kamera', () => {
  it('aç: iz örgüye "camera" yuvasına takılır, durum camera:true, change yayılır', async () => {
    const o = oturumKur()
    await o.join()
    const degisim = vi.fn()
    o.on('change', degisim)
    await o.setCamera(true)
    expect(o.getState().camera).toBe(true)
    expect(FakeMesh.son.izlar).toEqual([['camera', izlar[0]]])
    expect(degisim).toHaveBeenCalled()
  })
  it('kapa: iz stop() edilir ve yuva null olur', async () => {
    const o = oturumKur()
    await o.join()
    await o.setCamera(true)
    await o.setCamera(false)
    expect(izlar[0].stopped).toBe(true)
    expect(FakeMesh.son.izlar.at(-1)).toEqual(['camera', null])
    expect(o.getState().camera).toBe(false)
  })
  it('izin reddi: Türkçe hata, kamera kapalı kalır', async () => {
    const o = oturumKur({ kameraHatasi: new CameraError('denied', CAMERA_MESSAGES.denied) })
    await o.join()
    await o.setCamera(true)
    expect(o.getState().camera).toBe(false)
    expect(o.getState().cameraError).toBe('Kamera izni verilmedi')
    expect(FakeMesh.son.izlar).toEqual([])
    // kapatınca hata temizlenir
    await o.setCamera(false)
    expect(o.getState().cameraError).toBeNull()
  })
  it('ayrılınca kamera kapanır', async () => {
    const o = oturumKur()
    await o.join()
    await o.setCamera(true)
    o.leave()
    expect(izlar[0].stopped).toBe(true)
    expect(o.getState().camera).toBe(false)
  })
  it('ayarlardaki kamera seçimi açılışta kullanılır', async () => {
    updateSettings({ cameraDeviceId: 'cam-ayar' })
    const ids = []
    const o = oturumKur({ kameraAc: async (id) => { ids.push(id); return sahteIz() } })
    await o.join()
    await o.setCamera(true)
    expect(ids).toEqual(['cam-ayar'])
  })
  it('kayıtlı kamera takılı değilse varsayılana döner ve seçimi unutur', async () => {
    updateSettings({ cameraDeviceId: 'eski' })
    const ids = []
    const o = oturumKur({ kameraAc: async (id) => { ids.push(id); if (id) throw new CameraError('no-camera', 'x'); return sahteIz() } })
    await o.join()
    await o.setCamera(true)
    expect(ids).toEqual(['eski', undefined])
    expect(o.getState().camera).toBe(true)
    expect(getSettings().cameraDeviceId).toBeNull()
  })
  it('açıkken kamera değişince canlı geçer: yeni iz takılır, eskisi durur', async () => {
    const o = oturumKur()
    await o.join()
    await o.setCamera(true)
    updateSettings({ cameraDeviceId: 'yeni' })
    await o.switchCamera()
    expect(izlar.length).toBe(2)
    expect(izlar[0].stopped).toBe(true)
    expect(FakeMesh.son.izlar.at(-1)).toEqual(['camera', izlar[1]])
    expect(o.getState().camera).toBe(true)
  })
  it('sistem izi bitirirse (ended) kamera kapanır', async () => {
    const o = oturumKur({
      kameraAc: async () => {
        const iz = sahteIz()
        iz.addEventListener = (ad, cb) => { if (ad === 'ended') iz.bitir = cb }
        izlar.push(iz)
        return iz
      },
    })
    await o.join()
    await o.setCamera(true)
    izlar[0].bitir()
    await Promise.resolve()
    expect(o.getState().camera).toBe(false)
  })
})

describe('kamera sıralama ve hata dayanıklılığı', () => {
  // Açılışı elle bitirilen kamera: gum çağrı sayısı ve izler izlenir
  function bekleyenKamera() {
    const bekleyenler = []
    const ac = vi.fn(() => new Promise((coz) => bekleyenler.push(coz)))
    return { ac, bitir: (i = 0) => { const iz = sahteIz(); izlar.push(iz); bekleyenler[i](iz); return iz } }
  }
  const bosalt = () => new Promise((r) => setTimeout(r, 0))

  it('çift tıklama (aç, aç): tek açılış, tek canlı iz', async () => {
    const k = bekleyenKamera()
    const o = oturumKur({ kameraAc: k.ac })
    await o.join()
    const p1 = o.setCamera(true)
    const p2 = o.setCamera(true)
    await bosalt(); k.bitir()
    await Promise.all([p1, p2])
    expect(k.ac).toHaveBeenCalledTimes(1)
    expect(izlar.filter((i) => !i.stopped).length).toBe(1)
    expect(o.getState().camera).toBe(true)
  })
  it('açılırken kapat: sonuç kapalı, iz durmuş', async () => {
    const k = bekleyenKamera()
    const o = oturumKur({ kameraAc: k.ac })
    await o.join()
    const p1 = o.setCamera(true)
    const p2 = o.setCamera(false)
    await bosalt(); k.bitir()
    await Promise.all([p1, p2])
    expect(o.getState().camera).toBe(false)
    expect(izlar.every((i) => i.stopped)).toBe(true)
    expect(FakeMesh.son.izlar.at(-1)).toEqual(['camera', null])
  })
  it('setLocalTrack reddederse: iz durur, kamera kapalı, hata görünür', async () => {
    const o = oturumKur()
    await o.join()
    FakeMesh.son.setLocalTrack = async (slot, iz) => { if (iz) throw new Error('patladı') }
    await o.setCamera(true)
    expect(izlar[0].stopped).toBe(true)
    expect(o.getState().camera).toBe(false)
    expect(o.getState().cameraError).toBe('Kamera açılamadı')
  })
  it('geçiş başarısız olursa eski iz canlı kalır, yenisi durur', async () => {
    const o = oturumKur()
    await o.join()
    await o.setCamera(true)
    FakeMesh.son.setLocalTrack = async (slot, iz) => { if (iz && iz !== izlar[0]) throw new Error('patladı') }
    updateSettings({ cameraDeviceId: 'yeni' })
    await o.switchCamera()
    expect(izlar[0].stopped).toBe(false)
    expect(izlar[1].stopped).toBe(true)
    expect(o.getState().camera).toBe(true)
    expect(o.getState().cameraError).toBe('Kamera açılamadı')
  })
  it('yedek cihaza dönüşte ayar dinleyicisinin tetiklediği ikinci geçiş yeni açılış yapmaz', async () => {
    const o = oturumKur()
    await o.join()
    await o.setCamera(true)
    const ids = []
    // Oturumun kendi kamera açıcısı yerine sayaçlı olanı: yeni oturum
    const o2 = oturumKur({ kameraAc: async (id) => { ids.push(id); if (id) throw new CameraError('no-camera', 'x'); const iz = sahteIz(); izlar.push(iz); return iz } })
    await o2.join()
    await o2.setCamera(true)
    ids.length = 0
    updateSettings({ cameraDeviceId: 'eski' })
    // app.js dinleyicisi gibi: ayar her değişince switchCamera
    const birak = (await import('../src/settings.js')).onSettingsChange(() => o2.switchCamera())
    await o2.switchCamera() // yedeğe düşer, updateSettings(null) dinleyiciyi tetikler
    await bosalt()
    birak()
    expect(ids).toEqual(['eski', undefined]) // ikinci geçiş açılış yapmadı
    expect(o2.getState().camera).toBe(true)
  })
})

describe('ayarlar ve presence', () => {
  it('cameraDeviceId varsayılan null', () => {
    expect(DEFAULTS.cameraDeviceId).toBeNull()
    expect(getSettings().cameraDeviceId).toBeNull()
    expect(updateSettings({ cameraDeviceId: '' }).cameraDeviceId).toBeNull()
  })
})

describe('odada ekran paylaşımı', () => {
  it('setRoomScreenOn örgüye iletilir; örgü kurulmadan verilirse kurulunca uygulanır', async () => {
    const o = oturumKur()
    o.setRoomScreenOn(true)
    await o.join()
    expect(FakeMesh.son.odadaEkran).toBe(true)
    o.setRoomScreenOn(false)
    expect(FakeMesh.son.odadaEkran).toBe(false)
  })
})

describe('bağlanmadan kamera', () => {
  it('örgü kurulmadan setCamera(true): kamera açılmaz ama change yayılır (tıklama sessizce kaybolmaz)', async () => {
    const o = oturumKur()
    const degisim = vi.fn()
    o.on('change', degisim)
    await o.setCamera(true)
    expect(o.getState().camera).toBe(false)
    expect(izlar).toHaveLength(0)
    expect(degisim).toHaveBeenCalled()
  })
})

describe('ses paneli kamera düğmesi', () => {
  const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, listenOnly: false, camera: false, cameraError: null, speaking: new Set(), ...ek })
  const ciz = (state, h = {}) => renderVoicePanel({ channelName: 'Lobi', state, handlers: h })
  const kamBtn = (p) => p.querySelector('button.camera-btn')

  it('kapalıyken "Kamerayı aç", SVG simge, basılı değil', () => {
    const b = kamBtn(ciz(durum()))
    expect(b.getAttribute('aria-label')).toBe('Kamerayı aç')
    expect(b.title).toBe('Kamerayı aç')
    expect(b.querySelector('svg.icon')).not.toBeNull()
    expect(b.classList.contains('active')).toBe(false)
  })
  it('açıkken "Kamerayı kapat" ve active; tıklayınca onToggleCamera', () => {
    const onToggleCamera = vi.fn()
    const b = kamBtn(ciz(durum({ camera: true }), { onToggleCamera }))
    expect(b.getAttribute('aria-label')).toBe('Kamerayı kapat')
    expect(b.classList.contains('active')).toBe(true)
    b.click()
    expect(onToggleCamera).toHaveBeenCalled()
  })
  it('bağlanırken (status connecting) kamera düğmesi kapalı (disabled); bağlanınca açık', () => {
    expect(kamBtn(ciz(durum({ status: 'connecting' }))).disabled).toBe(true)
    expect(kamBtn(ciz(durum({ status: 'connected' }))).disabled).toBe(false)
    expect(kamBtn(ciz(durum({ status: 'failed' }))).disabled).toBe(false)
  })
  it('kamera hatası panelde görünür', () => {
    const p = ciz(durum({ cameraError: 'Kamera izni verilmedi' }))
    expect(p.querySelector('.voice-error').textContent).toBe('Kamera izni verilmedi')
  })
})
