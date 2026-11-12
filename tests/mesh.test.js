// Eşler arası örgü (PeerMesh): sahte RTCPeerConnection ve sahte yayın kanalıyla.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PeerMesh, clampBitrate } from '../src/voice/mesh.js'
import { createNet, createBus, fakeStream, fakeLevelMeter } from './fakes/webrtc.js'

let net, bus
const meshler = []

// Bekleyen tüm Promise zincirlerini çalıştırır (sahte ağ mesajları dahil)
async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }

// Olayları dizi olarak kaydeden bir eş kurar
function esKur(userId, { localStream = fakeStream('mik-' + userId), channelId = 'k1' } = {}) {
  const m = new PeerMesh(
    { channelId, userId, localStream, iceServers: [{ urls: 'stun:x' }], signal: bus.signal },
    { RTCPeerConnection: net.RTCPeerConnection, createLevelMeter: fakeLevelMeter },
  )
  m.olaylar = []
  for (const ad of ['peer-joined', 'peer-left', 'peer-speaking', 'connect-failed', 'ready', 'failed-change']) {
    m.on(ad, (veri) => m.olaylar.push([ad, veri]))
  }
  m.yerel = localStream
  meshler.push(m)
  return m
}
const olay = (m, ad) => m.olaylar.filter(([a]) => a === ad).map(([, v]) => v)

beforeEach(() => {
  vi.useFakeTimers()
  net = createNet()
  bus = createBus()
})
afterEach(() => {
  meshler.splice(0).forEach((m) => m.leave())
  vi.useRealTimers()
})

describe('PeerMesh bağlantı', () => {
  it('aynı anda katılan iki eş tek bağlantı kurar', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join()
    b.join()
    await akit()
    // Toplam 2 RTCPeerConnection: her tarafta bir tane
    expect(net.pcs).toHaveLength(2)
    expect(olay(a, 'peer-joined').map((v) => v.userId)).toEqual(['bbb'])
    expect(olay(b, 'peer-joined').map((v) => v.userId)).toEqual(['aaa'])
    // Yalnızca küçük kimlik teklif gönderdi; her şey voice:<kanal> konusunda
    const teklifler = bus.sent.filter((s) => s.msg.type === 'offer')
    expect(teklifler).toHaveLength(1)
    expect(teklifler[0].msg.from).toBe('aaa')
    expect(bus.sent.every((s) => s.topic === 'voice:k1')).toBe(true)
    // ICE sunucuları dışarıdan gelir
    expect(net.pcs[0].config.iceServers).toEqual([{ urls: 'stun:x' }])
  })

  it('sonradan katılan eş de bağlanır (büyük kimlik önce içerideyse)', async () => {
    const b = esKur('bbb')
    b.join()
    await akit()
    const a = esKur('aaa')
    a.join()
    await akit()
    expect(net.pcs).toHaveLength(2)
    expect(olay(b, 'peer-joined').map((v) => v.userId)).toEqual(['aaa'])
    expect(olay(a, 'peer-joined').map((v) => v.userId)).toEqual(['bbb'])
  })

  it('sonradan katılan eş de bağlanır (küçük kimlik önce içerideyse)', async () => {
    const a = esKur('aaa')
    a.join()
    await akit()
    const b = esKur('bbb')
    b.join()
    await akit()
    expect(net.pcs).toHaveLength(2)
    expect(olay(a, 'peer-joined')).toHaveLength(1)
    expect(olay(b, 'peer-joined')).toHaveLength(1)
  })

  it('üç eş tam örgü kurar (her çift bir bağlantı)', async () => {
    const x = [esKur('a1'), esKur('b2'), esKur('c3')]
    x.forEach((m) => m.join())
    await akit()
    expect(net.pcs).toHaveLength(6)
    for (const m of x) expect(olay(m, 'peer-joined')).toHaveLength(2)
  })

  it('setLocalDescription öncesi SDP Opus ayarlarıyla düzenlenir ve maxBitrate ayarlanır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    for (const pc of net.pcs) {
      expect(pc.setLocalSdps[0]).toContain('maxaveragebitrate=128000')
      expect(pc.setLocalSdps[0]).toContain('useinbandfec=1')
      expect(pc.senders[0].params.encodings[0].maxBitrate).toBe(128000)
    }
  })

  it('bye gelince eş ayrılır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    b.leave()
    await akit()
    expect(olay(a, 'peer-left').map((v) => v.userId)).toEqual(['bbb'])
    expect(bus.sent.some((s) => s.msg.type === 'bye' && s.msg.from === 'bbb')).toBe(true)
    expect(net.pcs.every((p) => p.closed)).toBe(true)
  })

  it("bye gelmeden ICE 'failed' olursa 10 sn içinde peer-left", async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    net.pcs[0]._setIce('failed') // a'nın bağlantısı
    await vi.advanceTimersByTimeAsync(10000)
    expect(olay(a, 'peer-left').map((v) => v.userId)).toEqual(['bbb'])
    expect(olay(a, 'connect-failed')).toHaveLength(0) // önceden bağlıydı: "bağlanamadı" değil
  })

  it("ICE 10 sn'den uzun 'disconnected' kalırsa düşer; kısa kopmada düşmez", async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const pcA = net.pcs[0]
    pcA._setIce('disconnected')
    await vi.advanceTimersByTimeAsync(5000)
    pcA._setIce('connected') // kendiliğinden düzeldi
    await vi.advanceTimersByTimeAsync(10000)
    expect(olay(a, 'peer-left')).toHaveLength(0)
    pcA._setIce('disconnected')
    await vi.advanceTimersByTimeAsync(9999)
    expect(olay(a, 'peer-left')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(olay(a, 'peer-left').map((v) => v.userId)).toEqual(['bbb'])
  })

  it('kopan eşle bir sonraki hello ile yeniden bağlantı kurulur', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    // İki tarafta da bağlantı bozuldu
    net.pcs[0]._setIce('failed')
    net.pcs[1]._setIce('failed')
    await akit()
    expect(olay(a, 'peer-left')).toHaveLength(1)
    expect(olay(b, 'peer-left')).toHaveLength(1)
    // Düşerken gönderilen hello yeni bir bağlantı başlatır
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(2)
    expect(olay(b, 'peer-joined')).toHaveLength(2)
  })

  it('hiç bağlantı kurulamazsa connect-failed', async () => {
    net.autoConnect = false
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    expect(net.pcs).toHaveLength(2)
    net.pcs[0]._setIce('checking')
    net.pcs[0]._setIce('failed')
    await akit()
    expect(olay(a, 'connect-failed').map((v) => v.userId)).toEqual(['bbb'])
    expect(olay(a, 'peer-joined')).toHaveLength(0)
    expect(olay(a, 'peer-left')).toHaveLength(0) // hiç katılmamıştı
  })

  it('bağlantı 15 sn içinde kurulamazsa da connect-failed (ve sonsuz deneme yok)', async () => {
    net.autoConnect = false
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    await vi.advanceTimersByTimeAsync(15000)
    expect(olay(a, 'connect-failed')).toHaveLength(1)
    expect(olay(b, 'connect-failed')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(net.pcs).toHaveLength(2) // aynı oturumla tekrar tekrar denenmedi
  })

  it('mikrofonu olmayan (sadece dinleyen) eş de bağlanır', async () => {
    const a = esKur('aaa', { localStream: null })
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(1)
    const pcA = net.pcs[0]
    expect(pcA.senders).toHaveLength(0)
    expect(pcA.transceivers[0]).toEqual({ kind: 'audio', init: { direction: 'recvonly' } })
  })

  it('sayfayı yenileyen (yeni oturumla hello gönderen) eşle bağlantı yeniden kurulur', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    // b, bye gönderemeden sayfayı kapattı ve yeniden açtı
    bus.subs[1].open = false
    const b2 = esKur('bbb')
    b2.join()
    await akit()
    expect(olay(a, 'peer-left')).toHaveLength(1)
    expect(olay(a, 'peer-joined')).toHaveLength(2)
    expect(olay(b2, 'peer-joined')).toHaveLength(1)
  })
})

describe('PeerMesh ses kontrolleri', () => {
  it('setDeafened(true) gelen tüm sesleri susturur ve kendi mikrofonunu da kapatır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    const c = esKur('ccc')
    ;[a, b, c].forEach((m) => m.join())
    await akit()
    const gelenler = olay(a, 'peer-joined').map((v) => v.stream)
    expect(gelenler).toHaveLength(2)
    a.setDeafened(true)
    for (const s of gelenler) expect(s.getAudioTracks()[0].enabled).toBe(false)
    expect(a.yerel.getAudioTracks()[0].enabled).toBe(false)
    a.setDeafened(false)
    for (const s of gelenler) expect(s.getAudioTracks()[0].enabled).toBe(true)
    expect(a.yerel.getAudioTracks()[0].enabled).toBe(true)
  })

  it('sağırken yeni katılan eşin sesi de kapalı gelir', async () => {
    const a = esKur('aaa')
    a.setDeafened(true)
    a.join()
    await akit()
    const b = esKur('bbb')
    b.join()
    await akit()
    const [{ stream }] = olay(a, 'peer-joined')
    expect(stream.getAudioTracks()[0].enabled).toBe(false)
  })

  it('setBitrate 32–128 aralığına sıkıştırır ve göndericilere uygular', async () => {
    expect(clampBitrate(500)).toBe(128)
    expect(clampBitrate(5)).toBe(32)
    expect(clampBitrate(64)).toBe(64)
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    expect(a.setBitrate(10)).toBe(32)
    await akit()
    expect(net.pcs[0].senders[0].params.encodings[0].maxBitrate).toBe(32000)
    a.setBitrate(96)
    await akit()
    expect(net.pcs[0].senders[0].params.encodings[0].maxBitrate).toBe(96000)
  })

  it('gelen ses eşiği geçince 100 ms içinde peer-speaking', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const [{ stream }] = olay(a, 'peer-joined')
    stream.level = 0.3
    await vi.advanceTimersByTimeAsync(100)
    expect(olay(a, 'peer-speaking')).toEqual([{ userId: 'bbb', speaking: true }])
    stream.level = 0
    await vi.advanceTimersByTimeAsync(100)
    expect(olay(a, 'peer-speaking').at(-1)).toEqual({ userId: 'bbb', speaking: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(olay(a, 'peer-speaking')).toHaveLength(2) // sadece değişince bildirilir
  })
})

describe('PeerMesh yeniden bağlanma', () => {
  const hellolar = (id = 'aaa') => bus.sent.filter((s) => s.msg.type === 'hello' && s.msg.from === id).length

  it('kanal hatasından sonra realtime kendisi yeniden katılınca (SUBSCRIBED) hello tekrar gönderilir', async () => {
    const a = esKur('aaa')
    a.join()
    await akit()
    expect(olay(a, 'ready')).toHaveLength(1)
    const ilk = bus.subs[0]
    expect(hellolar()).toBe(1)
    bus.fail(ilk, 'CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(3000)
    expect(bus.subs).toHaveLength(1) // kanal yıkılmadı: realtime-js kendi yeniden dener
    ilk.onStatus('SUBSCRIBED') // realtime-js yeniden katıldı
    await akit()
    expect(hellolar()).toBe(2)
    expect(ilk.open).toBe(true)
    // Kopukken içeri giren eş bağlanır
    const b = esKur('bbb')
    b.join()
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(1)
  })

  it('hatadan sonra 20 sn içinde yeniden katılım olmazsa kanal yıkılıp taze abone olunur', async () => {
    const a = esKur('aaa')
    a.join()
    await akit()
    const ilk = bus.subs[0]
    bus.fail(ilk, 'TIMED_OUT')
    await vi.advanceTimersByTimeAsync(19999)
    expect(bus.subs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1 + 2000)
    await akit()
    expect(ilk.open).toBe(false)
    expect(bus.subs).toHaveLength(2)
    expect(hellolar()).toBe(2)
  })

  it('CLOSED gelirse eski kanalın kapanışı BİTTİKTEN sonra taze kanal açılır', async () => {
    let ac
    bus.closeGate = new Promise((r) => { ac = r })
    const a = esKur('aaa')
    a.join()
    await akit()
    bus.fail(bus.subs[0], 'CLOSED')
    await vi.advanceTimersByTimeAsync(5000)
    await akit()
    expect(bus.subs).toHaveLength(1) // kapanış bitmedi: yeni kanal yok
    ac()
    await akit()
    expect(bus.subs).toHaveLength(2)
    expect(hellolar()).toBe(2)
  })

  it('yeniden abone olunca sağlam bağlantılar bozulmaz', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    bus.fail(bus.subs[0], 'CLOSED')
    await vi.advanceTimersByTimeAsync(3000)
    await akit()
    expect(bus.subs).toHaveLength(3)
    expect(net.pcs).toHaveLength(2) // yeni bağlantı açılmadı
    expect(olay(b, 'peer-left')).toHaveLength(0)
  })

  it('eski (yarı kapalı) kanaldan gelen mesajlar yok sayılır', async () => {
    const a = esKur('aaa')
    a.join()
    await akit()
    const ilk = bus.subs[0]
    bus.fail(ilk, 'CLOSED')
    await vi.advanceTimersByTimeAsync(3000)
    await akit()
    ilk.onMessage({ type: 'hello', from: 'zzz', session: 's' })
    ilk.onStatus('SUBSCRIBED')
    await akit()
    expect(net.pcs).toHaveLength(0)
    expect(hellolar()).toBe(2)
  })

  it('leave sonrası hiçbir zamanlayıcı ve açık kanal kalmaz', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    bus.fail(bus.subs[0], 'CHANNEL_ERROR') // bekçi zamanlayıcısı da temizlenmeli
    a.leave()
    b.leave()
    await akit()
    expect(vi.getTimerCount()).toBe(0)
    expect(bus.subs.every((s) => !s.open)).toBe(true)
  })
})

describe('PeerMesh geciken cevaplar', () => {
  it('yeniden kurulan eşe eski teklifin cevabı gelirse yok sayılır', async () => {
    bus.hold = (m) => m.type === 'answer'
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const eskiCevap = bus.held[0].msg
    expect(eskiCevap.offerId).toBeTruthy()
    bus.held.length = 0
    // b sayfayı yeniledi (yeni oturum) -> a eski bağlantıyı bırakır, yeni teklif gönderir.
    // Yeni cevap da tutuluyor: a'nın yeni bağlantısı cevap BEKLİYOR (have-local-offer).
    bus.subs[1].open = false
    const b2 = esKur('bbb')
    b2.join()
    await akit()
    const yeniPc = net.pcs.filter((p) => !p.closed && p.localDescription?.type === 'offer')[0]
    expect(yeniPc.signalingState).toBe('have-local-offer')
    // Eski teklifin cevabı şimdi geliyor: yeni bağlantıya uygulanmamalı
    bus.subs[0].onMessage(eskiCevap)
    await akit()
    expect(yeniPc.remoteDescription).toBeNull()
    expect(olay(a, 'connect-failed')).toHaveLength(0)
    // Doğru cevap gelince bağlanır
    bus.hold = null
    bus.release()
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(1)
    expect(olay(b2, 'peer-joined')).toHaveLength(1)
    expect(yeniPc.closed).toBe(false)
  })

  it('teklif beklenmiyorken (stable) gelen cevap bağlantıyı bozmaz', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const cevap = bus.sent.find((s) => s.msg.type === 'answer').msg
    bus.subs[0].onMessage(structuredClone(cevap)) // aynı cevap ikinci kez
    await akit()
    expect(olay(a, 'peer-left')).toHaveLength(0)
    expect(olay(a, 'connect-failed')).toHaveLength(0)
    expect(net.pcs[0].closed).toBe(false)
  })

  it('başka bir teklife ait ICE adayı yok sayılır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const once = net.pcs[0].candidates.length
    bus.subs[0].onMessage({ type: 'ice', from: 'bbb', to: 'aaa', session: 'x', offerId: 'eski', candidate: { candidate: 'c' } })
    await akit()
    expect(net.pcs[0].candidates.length).toBe(once)
  })
})

describe('PeerMesh bağlanamama sonrası yeniden deneme', () => {
  async function basarisizIkili() {
    net.autoConnect = false
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    await vi.advanceTimersByTimeAsync(15000)
    expect(olay(a, 'connect-failed')).toHaveLength(1)
    expect(a.failedPeerCount()).toBe(1)
    net.autoConnect = true
    return { a, b }
  }

  it('yeni bir SUBSCRIBED döngüsünde (realtime yeniden katıldı) tekrar denenir', async () => {
    const { a, b } = await basarisizIkili()
    bus.subs[0].onStatus('SUBSCRIBED')
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(1)
    expect(olay(b, 'peer-joined')).toHaveLength(1)
    expect(a.failedPeerCount()).toBe(0)
  })

  it("reconnect() (internet geri geldi) tekrar dener; durum düzelince 'failed-change' yayılır", async () => {
    const { a, b } = await basarisizIkili()
    const degisim = olay(a, 'failed-change').length
    b.reconnect()
    await akit()
    expect(olay(a, 'peer-joined')).toHaveLength(1)
    expect(a.failedPeerCount()).toBe(0)
    expect(olay(a, 'failed-change').length).toBeGreaterThan(degisim)
  })

  it('bağlanamayan eş bye ile ayrılırsa başarısızlar listesinden düşer', async () => {
    const { a, b } = await basarisizIkili()
    b.leave()
    await akit()
    expect(a.failedPeerCount()).toBe(0)
  })
})

describe('PeerMesh gerçek seviye ölçer', () => {
  it('askıdaki (suspended) AudioContext uyandırılır', async () => {
    const kayit = { resume: 0 }
    class SahteCtx {
      constructor() { this.state = 'suspended' }
      resume() { kayit.resume++; this.state = 'running'; return Promise.resolve() }
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData() {} } }
      close() {}
    }
    const kur = (id) => {
      const m = new PeerMesh(
        { channelId: 'k1', userId: id, localStream: fakeStream(id), iceServers: [], signal: bus.signal },
        { RTCPeerConnection: net.RTCPeerConnection, AudioContext: SahteCtx },
      )
      meshler.push(m)
      return m
    }
    const a = kur('aaa')
    const b = kur('bbb')
    a.join(); b.join()
    await akit()
    expect(kayit.resume).toBeGreaterThan(0)
  })
})
