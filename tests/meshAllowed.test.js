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

  it('null: herkes (sesli kanal ve bire bir arama davranışı değişmez)', async () => {
    const a = esKur('aaa')
    const b = esKur('bbb')
    a.setAllowedPeers(null)
    a.join(); b.join()
    await akit()
    expect(bagli(a)).toEqual(['bbb'])
  })
})
