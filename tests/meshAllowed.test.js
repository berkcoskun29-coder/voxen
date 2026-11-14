// Grup araması izin listesi (011 düzeltme turu 1, I1): PeerMesh.setAllowedPeers — listede olmayan eşin
// bağlantısı kapanır ve sinyalleri yok sayılır; yeni izin verilen eşle bağlantı kurulur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PeerMesh } from '../src/voice/mesh.js'
import { createNet, createBus, fakeStream, fakeLevelMeter } from './fakes/webrtc.js'

let net, bus
const meshler = []
async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }
function esKur(userId) {
  const m = new PeerMesh(
    { channelId: 'k1', topic: 'dm-voice:k1', userId, localStream: fakeStream('mik-' + userId), iceServers: [], signal: bus.signal },
    { RTCPeerConnection: net.RTCPeerConnection, createLevelMeter: fakeLevelMeter },
  )
  m.olaylar = []
  for (const ad of ['peer-joined', 'peer-left']) m.on(ad, (v) => m.olaylar.push([ad, v.userId]))
  meshler.push(m)
  return m
}
const bagli = (m) => [...m.eslar.keys()].sort()

beforeEach(() => { vi.useFakeTimers(); net = createNet(); bus = createBus() })
afterEach(() => { meshler.splice(0).forEach((m) => m.leave()); vi.useRealTimers() })

describe('PeerMesh.setAllowedPeers', () => {
  it('izin verilmeyen eşin bağlantısı kapanır, yeniden hello göndermesi bağlantı kurmaz', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    const x = esKur('xxx')
    a.join(); b.join(); x.join()
    await akit()
    expect(bagli(a)).toEqual(['bbb', 'xxx'])
    a.setAllowedPeers(['bbb'])
    await akit()
    expect(bagli(a)).toEqual(['bbb'])
    expect(a.olaylar).toContainEqual(['peer-left', 'xxx'])
    // Çıkarılan eş yeniden duyurur (değiştirilmiş istemci): a bağlanmaz
    x._gonder({ type: 'hello' })
    await akit()
    expect(bagli(a)).toEqual(['bbb'])
  })

  it('sonradan izin verilen eşe özel hello gider ve bağlantı kurulur', async () => {
    const a = esKur('aaa')
    a.join()
    a.setAllowedPeers([])
    await akit()
    const y = esKur('yyy')
    y.join()
    await akit()
    expect(bagli(a)).toEqual([]) // y'nin hello'su izin yokken yok sayıldı
    a.setAllowedPeers(['yyy'])
    await akit()
    expect(bagli(a)).toEqual(['yyy'])
    expect(bus.sent.some((s) => s.msg.type === 'hello' && s.msg.from === 'aaa' && s.msg.to === 'yyy')).toBe(true)
  })

  it('v0.12 (v11 K1): herkes serbestken liste verilince kimseye hello gitmez; listede olmayanın teklifi yok sayılır', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.join(); b.join()
    await akit()
    const once = bus.sent.length
    a.setAllowedPeers(['bbb', 'ccc']) // sunucu üyeleri (ccc kanalda değil)
    await akit()
    expect(bus.sent.slice(once).some((s) => s.msg.from === 'aaa' && s.msg.type === 'hello')).toBe(false)
    expect(bagli(a)).toEqual(['bbb'])
    // Sunucudan çıkarılmış (listede olmayan) değiştirilmiş istemci doğrudan teklif gönderir: a cevap vermez
    const x = esKur('xxx')
    x.setAllowedPeers(null)
    x.join()
    await akit()
    expect(bagli(a)).toEqual(['bbb'])
    expect(bus.sent.some((s) => s.msg.from === 'aaa' && s.msg.to === 'xxx')).toBe(false)
  })

  it('inceleme KR1: izin listesinde olmayandan hello/teklif gelince "peer-not-allowed" yayılır; sonra izin verilince bağlanılır', async () => {
    const a = esKur('aaa')
    const reddedilen = []
    a.on('peer-not-allowed', ({ userId }) => reddedilen.push(userId))
    a.join()
    a.setAllowedPeers([])
    a.setAllowedPeers(['bbb']) // bbb henüz kanalda değil
    await akit()
    const y = esKur('yyy') // yeni katılan üye: a'nın listesi bayat
    y.join()
    await akit()
    expect(reddedilen).toContain('yyy')
    expect(bagli(a)).toEqual([])
    a.setAllowedPeers(['bbb', 'yyy']) // uygulama listeyi tazeledi
    await akit()
    expect(bagli(a)).toEqual(['yyy'])
  })

  it('null: herkes (sesli kanal ve bire bir arama davranışı değişmez)', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.setAllowedPeers(null)
    a.join(); b.join()
    await akit()
    expect(bagli(a)).toEqual(['bbb'])
  })
})
