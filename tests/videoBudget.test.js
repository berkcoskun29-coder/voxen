// 2. aşama, Görev 2: görüntü için toplam upload bütçesi (bant yöneticisi)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeVideoBudget } from '../src/voice/videoBudget.js'
import { PeerMesh } from '../src/voice/mesh.js'
import { DEFAULTS, getSettings, updateSettings } from '../src/settings.js'
import { createNet, createBus, fakeStream, fakeTrack, fakeLevelMeter } from './fakes/webrtc.js'

describe('computeVideoBudget (saf fonksiyon)', () => {
  it('10 Mbps, 4 izleyici, yalnız ekran: min(2500, 6000/4) = 1500 kbps', () => {
    const b = computeVideoBudget({ uploadMbps: 10, viewers: 4, cameraOn: false, screenOn: true })
    expect(b.screen).toEqual({ maxBitrate: 1500, scale: 1 })
    expect(b.camera.maxBitrate).toBe(null) // kapalı kaynağa dokunulmaz
  })

  it('tek izleyici: tavanlar geçerli (ekran 2500, kamera 1200)', () => {
    expect(computeVideoBudget({ uploadMbps: 10, viewers: 1, screenOn: true }).screen.maxBitrate).toBe(2500)
    expect(computeVideoBudget({ uploadMbps: 10, viewers: 1, cameraOn: true }).camera.maxBitrate).toBe(1200)
  })

  it('ekranla birlikte kamera: kamera <= 600, toplam <= 6000/4', () => {
    const b = computeVideoBudget({ uploadMbps: 10, viewers: 4, cameraOn: true, screenOn: true })
    expect(b.camera.maxBitrate).toBeLessThanOrEqual(600)
    expect(b.screen.maxBitrate).toBeGreaterThan(b.camera.maxBitrate) // ekran öncelikli
    expect(b.camera.maxBitrate + b.screen.maxBitrate).toBeLessThanOrEqual(1500)
    const bol = computeVideoBudget({ uploadMbps: 20, viewers: 1, cameraOn: true, screenOn: true })
    expect(bol.camera.maxBitrate).toBe(600)
    expect(bol.screen.maxBitrate).toBe(2500)
  })

  it('5 Mbps, çok izleyici, ekran + kamera: tabanın altına düşen için scale 2 veya 4', () => {
    // 3000/8 = 375 kbps pay: ekran 225 (< 300 taban), kamera 150
    const b = computeVideoBudget({ uploadMbps: 5, viewers: 8, cameraOn: true, screenOn: true })
    expect(b.screen.scale).toBe(2)
    expect(b.camera.scale).toBe(1)
    // daha da azalırsa 4
    const c = computeVideoBudget({ uploadMbps: 5, viewers: 20, cameraOn: true, screenOn: true })
    expect(c.screen.scale).toBe(4)
  })

  it('uploadMbps sayı değilse değişiklik yok', () => {
    const b = computeVideoBudget({ uploadMbps: undefined, viewers: 2, screenOn: true })
    expect(b.screen.maxBitrate).toBe(null)
  })

  it('odada ekran paylaşımı varken (roomScreenOn) kamera en fazla 500 kbps ve en az yarı çözünürlük (≈360p)', () => {
    const b = computeVideoBudget({ uploadMbps: 10, viewers: 1, cameraOn: true, roomScreenOn: true })
    expect(b.camera).toEqual({ maxBitrate: 500, scale: 2 })
    expect(b.screen.maxBitrate).toBe(null)
    // pay zaten azsa daha düşük kalır; ölçek 2'den küçük olmaz, 4 olabilir
    const az = computeVideoBudget({ uploadMbps: 5, viewers: 20, cameraOn: true, roomScreenOn: true })
    expect(az.camera.maxBitrate).toBeLessThanOrEqual(500)
    expect(az.camera.scale).toBeGreaterThanOrEqual(2)
    // kendi ekranımız da açıksa aynı kural
    const ikisi = computeVideoBudget({ uploadMbps: 20, viewers: 1, cameraOn: true, screenOn: true, roomScreenOn: true })
    expect(ikisi.camera).toEqual({ maxBitrate: 500, scale: 2 })
    expect(ikisi.screen.maxBitrate).toBe(2500)
    // kamera kapalıysa dokunulmaz; oda kuralı yokken eski davranış
    expect(computeVideoBudget({ uploadMbps: 10, viewers: 1, roomScreenOn: true }).camera.maxBitrate).toBe(null)
    expect(computeVideoBudget({ uploadMbps: 10, viewers: 1, cameraOn: true }).camera).toEqual({ maxBitrate: 1200, scale: 1 })
  })

  it('izleyici 0 -> değişiklik yok', () => {
    const b = computeVideoBudget({ uploadMbps: 10, viewers: 0, cameraOn: true, screenOn: true })
    expect(b.camera).toEqual({ maxBitrate: null, scale: 1 })
    expect(b.screen).toEqual({ maxBitrate: null, scale: 1 })
  })
})

describe('ayarlar: uploadMbps', () => {
  // (node ortamında localStorage yok: ayarlar bellekte tutulur)
  it('varsayılan 10; yalnız 5, 10, 20 kabul edilir', () => {
    expect(DEFAULTS.uploadMbps).toBe(10)
    expect(getSettings().uploadMbps).toBe(10)
    expect(updateSettings({ uploadMbps: 20 }).uploadMbps).toBe(20)
    expect(updateSettings({ uploadMbps: 7 }).uploadMbps).toBe(10)
    expect(updateSettings({ uploadMbps: 'x' }).uploadMbps).toBe(10)
    expect(updateSettings({ uploadMbps: 5 }).uploadMbps).toBe(5)
  })
})

// ---- Örgü: bütçe gönderici parametrelerine uygulanıyor ----
let net, bus
const meshler = []
async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }
function esKur(userId, { eski = false } = {}) {
  let signal = bus.signal
  if (eski) {
    signal = (topic, onMessage, onStatus) => {
      const s = bus.signal(topic, onMessage, onStatus)
      return { send: (msg) => { const { caps, ...geri } = msg; s.send(geri) }, close: () => s.close() }
    }
  }
  const m = new PeerMesh(
    { channelId: 'k1', userId, localStream: fakeStream('mik-' + userId), iceServers: [], signal, ...(eski ? { caps: [] } : {}) },
    { RTCPeerConnection: net.RTCPeerConnection, createLevelMeter: fakeLevelMeter },
  )
  meshler.push(m)
  return m
}
// pc'deki göndericiyi, yerel tarifteki m-satırı sırasına göre (0 mic, 1 camera, 2 screen, 3 screenAudio) bul
const gonderici = (pc, i) => pc.getTransceivers().filter((t) => t.mid != null).sort((x, y) => Number(x.mid) - Number(y.mid))[i].sender
const kodlama = (pc, i) => gonderici(pc, i).params.encodings[0]

describe('PeerMesh bütçe uygulaması', () => {
  beforeEach(() => { vi.useFakeTimers(); net = createNet(); bus = createBus() })
  afterEach(() => { meshler.splice(0).forEach((m) => m.leave()); vi.useRealTimers() })

  it('ekran açılınca izleyici sayısına göre bölünür; ses yüksek, görüntü düşük öncelik', async () => {
    const a = esKur('aaa'); const b = esKur('bbb'); const c = esKur('ccc')
    a.join(); b.join(); c.join()
    await akit()
    await a.setLocalTrack('screen', fakeTrack('video'))
    await akit()
    // a'nın iki eşi var (bbb, ccc): 6000/2 = 3000 -> tavan 2500
    for (const pc of net.pcs.filter((p) => a.eslar.get('bbb')?.pc === p || a.eslar.get('ccc')?.pc === p)) {
      expect(kodlama(pc, 2).maxBitrate).toBe(2500 * 1000)
      expect(kodlama(pc, 2).priority).toBe('low')
      expect(kodlama(pc, 0).priority).toBe('high') // mikrofon
      expect(kodlama(pc, 3).priority).toBe('medium') // ekran sesi
    }
  })

  it('eski sürüm eş izleyici sayılmaz: bütçeyi paylaşmaz', async () => {
    const a = esKur('aaa'); const yeni = esKur('bbb'); const eski = esKur('ccc', { eski: true })
    a.join(); yeni.join(); eski.join()
    await akit()
    expect(a._izleyiciSayisi()).toBe(1)
    await a.setLocalTrack('screen', fakeTrack('video'))
    await akit()
    expect(kodlama(a.eslar.get('bbb').pc, 2).maxBitrate).toBe(2500 * 1000)
  })

  it('uploadMbps değişince applyVideoBudget çağrılıyor', async () => {
    const a = esKur('aaa'); const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    await a.setLocalTrack('screen', fakeTrack('video'))
    const spy = vi.spyOn(a, 'applyVideoBudget')
    a.setUploadMbps(5) // 3000 kbps pay, tek izleyici -> tavan 2500 altında kalmaz ama çağrılmalı
    expect(spy).toHaveBeenCalledTimes(1)
    a.setUploadMbps(5) // değişmedi: yeniden hesap yok
    expect(spy).toHaveBeenCalledTimes(1)
    a.setUploadMbps(999) // geçersiz -> 10
    expect(a.uploadMbps).toBe(10)
  })

  it('bağlanınca mikrofon göndericisine hem bit hızı hem öncelik yazılır (yarışsız)', async () => {
    const a = esKur('aaa'); const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const mik = kodlama(a.eslar.get('bbb').pc, 0)
    expect(mik.maxBitrate).toBe(128 * 1000)
    expect(mik.priority).toBe('high')
    // hızlı kamera aç-kapa da sıralı yazılır
    const g = gonderici(a.eslar.get('bbb').pc, 1)
    a.setLocalTrack('camera', fakeTrack('video')); a.setLocalTrack('camera', null); a.setLocalTrack('camera', fakeTrack('video'))
    await akit()
    expect(g.params.encodings[0].priority).toBe('low')
    expect(g.params.encodings[0].maxBitrate).toBe(1200 * 1000)
  })

  it('odada biri ekran paylaşınca kameramız 500 kbps / yarı çözünürlüğe iner, bitince geri döner', async () => {
    const a = esKur('aaa'); const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    await a.setLocalTrack('camera', fakeTrack('video'))
    await akit()
    const kam = () => kodlama(a.eslar.get('bbb').pc, 1)
    expect(kam().maxBitrate).toBe(1200 * 1000)
    a.setRoomScreenOn(true)
    await akit()
    expect(kam().maxBitrate).toBe(500 * 1000)
    expect(kam().scaleResolutionDownBy).toBe(2)
    a.setRoomScreenOn(false)
    await akit()
    expect(kam().maxBitrate).toBe(1200 * 1000)
    expect(kam().scaleResolutionDownBy).toBe(1)
  })

  it('kendi ekranımız açıkken de kamera oda kuralına uyar', async () => {
    const a = esKur('aaa'); const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    a.setUploadMbps(20)
    await a.setLocalTrack('camera', fakeTrack('video'))
    await a.setLocalTrack('screen', fakeTrack('video'))
    await akit()
    expect(kodlama(a.eslar.get('bbb').pc, 1).maxBitrate).toBe(500 * 1000)
    expect(kodlama(a.eslar.get('bbb').pc, 1).scaleResolutionDownBy).toBe(2)
  })

  it('yeni eş bağlanınca bütçe yeniden hesaplanır', async () => {
    const a = esKur('aaa'); const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    a.setUploadMbps(5)
    await a.setLocalTrack('screen', fakeTrack('video'))
    await akit()
    expect(kodlama(a.eslar.get('bbb').pc, 2).maxBitrate).toBe(2500 * 1000) // 3000 kbps, 1 izleyici
    const c = esKur('ccc')
    c.join()
    await akit()
    expect(kodlama(a.eslar.get('bbb').pc, 2).maxBitrate).toBe(1500 * 1000) // 3000/2
    c.leave()
    await akit()
    expect(kodlama(a.eslar.get('bbb').pc, 2).maxBitrate).toBe(2500 * 1000)
  })
})
