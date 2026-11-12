// 2. aşama, Görev 1: görüntü transceiver altyapısı (kamera, ekran, ekran sesi).
// Sahte RTCPeerConnection Chromium gibi davranır (bkz. tests/fakes/webrtc.js): cevaplayanın
// addTransceiver ile önceden açtıkları eşleşmez; sıra/mid hataları burada yakalanır.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PeerMesh, MEDIA_SLOTS } from '../src/voice/mesh.js'
import { createNet, createBus, fakeStream, fakeTrack, fakeLevelMeter, fakeSdpBolumleri } from './fakes/webrtc.js'

let net, bus
const meshler = []

async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }

// eski: true -> v0.1.0 gibi davranan eş (görüntü yok, mesajlarında caps alanı hiç yok)
function esKur(userId, { localStream = fakeStream('mik-' + userId), eski = false } = {}) {
  let signal = bus.signal
  if (eski) {
    signal = (topic, onMessage, onStatus) => {
      const s = bus.signal(topic, onMessage, onStatus)
      return { send: (msg) => { const { caps, ...geri } = msg; s.send(geri) }, close: () => s.close() }
    }
  }
  const m = new PeerMesh(
    { channelId: 'k1', userId, localStream, iceServers: [], signal, ...(eski ? { caps: [] } : {}) },
    { RTCPeerConnection: net.RTCPeerConnection, createLevelMeter: fakeLevelMeter },
  )
  m.olaylar = []
  for (const ad of ['peer-joined', 'peer-left', 'peer-speaking', 'peer-track']) {
    m.on(ad, (veri) => m.olaylar.push([ad, veri]))
  }
  meshler.push(m)
  return m
}
const olay = (m, ad) => m.olaylar.filter(([a]) => a === ad).map(([, v]) => v)
// Bir eşten gelen, o slot için en son bildirilen iz
const sonIz = (m, peerId, slot) => olay(m, 'peer-track').filter((v) => v.peerId === peerId && v.slot === slot).at(-1)?.track
// Bir pc'de, yerel tarifteki m-satırı sırasına göre transceiver'lar (slot sırası)
function sirali(pc) {
  const midler = fakeSdpBolumleri(pc.localDescription.sdp).map((b) => b.mid)
  return midler.map((mid) => pc.getTransceivers().find((t) => t.mid === mid))
}

beforeEach(() => {
  vi.useFakeTimers()
  net = createNet()
  bus = createBus()
})
afterEach(() => {
  meshler.splice(0).forEach((m) => m.leave())
  vi.useRealTimers()
})

describe('Görüntü transceiver altyapısı', () => {
  it("slot listesi ve hello'da caps: ['video']", async () => {
    expect(MEDIA_SLOTS).toEqual(['mic', 'camera', 'screen', 'screenAudio'])
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const hellolar = bus.sent.filter((s) => s.msg.type === 'hello')
    expect(hellolar.length).toBeGreaterThan(0)
    for (const h of hellolar) expect(h.msg.caps).toEqual(['video'])
    expect(a.peerCaps('bbb')).toEqual(['video'])
    expect(b.peerCaps('aaa')).toEqual(['video'])
    expect(a.peerCaps('yok')).toEqual([])
  })

  it('iki görüntü destekli eş: 4 transceiver, iki tarafta sıra ve türler eşleşiyor', async () => {
    const a = esKur('aaa') // küçük kimlik: teklifi gönderen
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const [pcA, pcB] = net.pcs
    const sA = sirali(pcA)
    const sB = sirali(pcB)
    expect(sA.map((t) => t.kind)).toEqual(['audio', 'video', 'video', 'audio'])
    expect(sB.map((t) => t.kind)).toEqual(['audio', 'video', 'video', 'audio'])
    expect(sA.map((t) => t.mid)).toEqual(sB.map((t) => t.mid))
    // Görüntü slotları iki yönde de gönderebilir (sonradan replaceTrack yetsin diye)
    for (const t of [...sA.slice(1), ...sB.slice(1)]) expect(t.currentDirection).toBe('sendrecv')
    // Her iki taraf da karşının kamera/ekran/ekran sesi izini aldı
    for (const [m, karsi] of [[a, 'bbb'], [b, 'aaa']]) {
      expect(sonIz(m, karsi, 'camera').kind).toBe('video')
      expect(sonIz(m, karsi, 'screen').kind).toBe('video')
      expect(sonIz(m, karsi, 'screenAudio').kind).toBe('audio')
      expect(olay(m, 'peer-track').some((v) => v.slot === 'mic')).toBe(false)
    }
  })

  it("setLocalTrack('camera') karşıdaki kamera izine gider, yeniden pazarlık yapmaz", async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const teklifSayisi = net.pcs.map((p) => p.createOfferCalls)
    const kamera = fakeTrack('video')
    await a.setLocalTrack('camera', kamera)
    await akit()
    expect(sonIz(b, 'aaa', 'camera').kaynak).toBe(kamera)
    expect(sonIz(b, 'aaa', 'camera').muted).toBe(false)
    expect(sonIz(b, 'aaa', 'screen').kaynak).toBe(null)
    // Cevaplayan taraf da gönderebilir: b ekranını paylaşır
    const ekran = fakeTrack('video')
    const ekranSesi = fakeTrack('audio')
    await b.setLocalTrack('screen', ekran)
    await b.setLocalTrack('screenAudio', ekranSesi)
    expect(sonIz(a, 'bbb', 'screen').kaynak).toBe(ekran)
    expect(sonIz(a, 'bbb', 'screenAudio').kaynak).toBe(ekranSesi)
    expect(sonIz(a, 'bbb', 'camera').kaynak).toBe(null)
    // Kapatınca iz akmaz
    await a.setLocalTrack('camera', null)
    expect(sonIz(b, 'aaa', 'camera').kaynak).toBe(null)
    expect(net.pcs.map((p) => p.createOfferCalls)).toEqual(teklifSayisi)
    expect(net.pcs).toHaveLength(2)
  })

  it('geçersiz slot reddedilir', async () => {
    const a = esKur('aaa')
    await expect(a.setLocalTrack('mic', fakeTrack())).rejects.toThrow()
  })

  it.each([
    ['teklif eden (aaa) mikrofonsuz', 'aaa'],
    ['cevaplayan (bbb) mikrofonsuz', 'bbb'],
  ])('mikrofonsuz katılımda slot eşlemesi doğru: %s', async (_ad, dinleyici) => {
    const a = esKur('aaa', dinleyici === 'aaa' ? { localStream: null } : {})
    const b = esKur('bbb', dinleyici === 'bbb' ? { localStream: null } : {})
    a.join(); b.join()
    await akit()
    for (const pc of net.pcs) {
      expect(sirali(pc).map((t) => t.kind)).toEqual(['audio', 'video', 'video', 'audio'])
    }
    const kamera = fakeTrack('video')
    const ekran = fakeTrack('video')
    const ekranSesi = fakeTrack('audio')
    await a.setLocalTrack('camera', kamera)
    await b.setLocalTrack('screen', ekran)
    await b.setLocalTrack('screenAudio', ekranSesi)
    expect(sonIz(b, 'aaa', 'camera').kaynak).toBe(kamera)
    expect(sonIz(a, 'bbb', 'screen').kaynak).toBe(ekran)
    expect(sonIz(a, 'bbb', 'screenAudio').kaynak).toBe(ekranSesi)
    expect(sonIz(a, 'bbb', 'camera').kaynak).toBe(null)
    // Mikrofonu olan taraf konuşunca diğeri duyar (ses bozulmadı)
    const konusan = dinleyici === 'aaa' ? b : a
    const dinleyen = dinleyici === 'aaa' ? a : b
    expect(olay(dinleyen, 'peer-joined')[0].stream).toBeTruthy()
    expect(olay(konusan, 'peer-joined')).toHaveLength(1)
  })

  it.each([
    ['eski eş cevaplayan', 'zzz'],
    ['eski eş teklif eden', '000'],
  ])('eski sürüm eş (caps yok): yalnız 1 ses transceiver, görüntü gönderilmez (%s)', async (_ad, eskiId) => {
    const yeni = esKur('mmm')
    const eski = esKur(eskiId, { eski: true })
    yeni.join(); eski.join()
    await akit()
    expect(net.pcs).toHaveLength(2)
    for (const pc of net.pcs) {
      expect(pc.getTransceivers().filter((t) => t.mid != null)).toHaveLength(1)
      expect(fakeSdpBolumleri(pc.localDescription.sdp)).toHaveLength(1)
    }
    expect(yeni.peerCaps(eskiId)).toEqual([])
    // Ses aynen çalışıyor
    expect(olay(yeni, 'peer-joined')).toHaveLength(1)
    expect(olay(eski, 'peer-joined')).toHaveLength(1)
    // Kamera açılınca o eşe hiçbir şey gitmez
    const kamera = fakeTrack('video')
    await yeni.setLocalTrack('camera', kamera)
    const pcYeni = net.pcs.find((p) => p.senders.length && p.senders[0].track === yeni.localStream.getAudioTracks()[0])
    for (const s of pcYeni.getSenders()) expect(s.track).not.toBe(kamera)
    for (const s of pcYeni.getSenders()) expect(s.replaceCalls).toEqual([])
    expect(olay(eski, 'peer-track')).toHaveLength(0)
    expect(olay(yeni, 'peer-track')).toHaveLength(0)
  })

  it.each([
    ['kamerası açık taraf teklif eden', 'aaa'],
    ['kamerası açık taraf cevaplayan', 'bbb'],
  ])('eş yeniden kurulunca açık kamera izi yeniden takılıyor (%s)', async (_ad, paylasan) => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const [gonderen, alan, gonderenId] = paylasan === 'aaa' ? [a, b, 'aaa'] : [b, a, 'bbb']
    const kamera = fakeTrack('video')
    await gonderen.setLocalTrack('camera', kamera)
    const ilkIz = sonIz(alan, gonderenId, 'camera')
    expect(ilkIz.kaynak).toBe(kamera)
    // Bağlantı koptu: eşler düşer, hello ile yeniden kurulur
    net.pcs[0]._setIce('failed')
    net.pcs[1]._setIce('failed')
    await akit()
    await akit()
    expect(net.pcs).toHaveLength(4)
    expect(olay(alan, 'peer-joined')).toHaveLength(2)
    // Düşerken iz kaldırıldı (null), sonra yeni bağlantıda yeni iz geldi ve kamera akıyor
    const izler = olay(alan, 'peer-track').filter((v) => v.slot === 'camera').map((v) => v.track)
    expect(izler).toContain(null)
    const yeniIz = sonIz(alan, gonderenId, 'camera')
    expect(yeniIz).not.toBe(ilkIz)
    expect(yeniIz.kaynak).toBe(kamera)
  })

  it('es.akis yalnız mikrofon: peer-joined akışı mikrofon akışı, konuşan halkası çalışır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const [{ stream }] = olay(a, 'peer-joined')
    expect(stream).toBe(net.pcs[1].outStream) // b'nin mikrofonu; ekran sesi değil
    stream.level = 0.3
    await vi.advanceTimersByTimeAsync(100)
    expect(olay(a, 'peer-speaking')).toEqual([{ userId: 'bbb', speaking: true }])
    // Sağırlaştırma ekran sesini de susturur
    a.setDeafened(true)
    expect(sonIz(a, 'bbb', 'screenAudio').enabled).toBe(false)
    expect(stream.getAudioTracks()[0].enabled).toBe(false)
    a.setDeafened(false)
    expect(sonIz(a, 'bbb', 'screenAudio').enabled).toBe(true)
  })

  it('tuneOpus yalnız mikrofon m-satırına; ekran sesi stereo 128 kbps', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.setBitrate(64)
    b.setBitrate(64)
    a.join(); b.join()
    await akit()
    for (const pc of net.pcs) {
      const [mik, , , ekranSesi] = fakeSdpBolumleri(pc.setLocalSdps[0])
      expect(mik.metin).toContain('maxaveragebitrate=64000')
      expect(mik.metin).toContain('stereo=0')
      expect(ekranSesi.metin).toContain('stereo=1')
      expect(ekranSesi.metin).toContain('maxaveragebitrate=128000')
      expect(ekranSesi.metin).not.toContain('stereo=0')
    }
    // Ses bit hızı (setParameters) yalnız mikrofon göndericisine uygulanır
    await a.setLocalTrack('screenAudio', fakeTrack('audio'))
    a.setBitrate(32)
    await akit()
    const pcA = net.pcs[0]
    const ekranGonderici = sirali(pcA)[3].sender
    // (Görev 2: ekran sesi göndericisine yalnız öncelik yazılır; bit hızına dokunulmaz)
    expect(ekranGonderici.setCalls.some((p) => p.encodings[0].priority === 'medium')).toBe(true)
    for (const p of ekranGonderici.setCalls) expect(p.encodings[0].maxBitrate).toBeUndefined()
    expect(pcA.senders[0].params.encodings[0].maxBitrate).toBe(32000)
  })

  it('eş ayrılınca görüntü izleri null olarak bildirilir', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    b.leave()
    await akit()
    for (const slot of ['camera', 'screen', 'screenAudio']) expect(sonIz(a, 'bbb', slot)).toBe(null)
  })
})
