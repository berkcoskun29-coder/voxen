// Supabase sinyal yolu: realtime-js'in "aynı konu = aynı kanal nesnesi" davranışına karşı.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeRealtime } from './fakes/realtime.js'

const h = vi.hoisted(() => ({ rt: null }))
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    channel: (...a) => h.rt.client.channel(...a),
    removeChannel: (...a) => h.rt.client.removeChannel(...a),
    realtime: { setAuth: (...a) => h.rt.client.realtime.setAuth(...a) },
  },
}))

import { supabaseSignal } from '../src/voice/signal.js'
import { PeerMesh } from '../src/voice/mesh.js'

async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }

beforeEach(() => { h.rt = createFakeRealtime() })

describe('supabaseSignal', () => {
  it('özel (private) kanal açar ve abone olmadan önce oturum anahtarını (JWT) yeniler', async () => {
    const durumlar = []
    supabaseSignal('voice:k1', () => {}, (d) => durumlar.push(d))
    await akit()
    expect(h.rt.created[0].topic).toBe('voice:k1')
    expect(h.rt.created[0].params.config.private).toBe(true)
    expect(h.rt.created[0].params.config.broadcast.self).toBe(false)
    expect(h.rt.log.slice(0, 2)).toEqual(['setAuth', 'channel'])
    expect(durumlar).toEqual(['SUBSCRIBED'])
  })

  it('close() kanal tamamen bırakılınca biten bir Promise döner', async () => {
    const s = supabaseSignal('voice:k1', () => {}, () => {})
    await akit()
    let bitti = false
    s.close().then(() => { bitti = true })
    expect(h.rt.channels).toHaveLength(1)
    await akit()
    expect(bitti).toBe(true)
    expect(h.rt.channels).toHaveLength(0)
  })

  it('aynı konuya kapanış bitmeden yeniden abone olunursa kapanışı bekler, taze kanal açar', async () => {
    let ac
    h.rt.removeGate = new Promise((r) => { ac = r })
    const s1 = supabaseSignal('voice:k1', () => {}, () => {})
    await akit()
    s1.close()
    const durumlar = []
    supabaseSignal('voice:k1', () => {}, (d) => durumlar.push(d))
    await akit()
    expect(durumlar).toEqual([]) // eski kanal hâlâ kapanıyor
    ac()
    await akit()
    expect(h.rt.created).toHaveLength(2)
    expect(durumlar).toEqual(['SUBSCRIBED'])
  })

  it('kanal açılmadan kapatılırsa hiç kanal kalmaz', async () => {
    const s = supabaseSignal('voice:k1', () => {}, () => {})
    await s.close()
    await akit()
    expect(h.rt.channels).toHaveLength(0)
  })
})

describe('PeerMesh + supabaseSignal', () => {
  it('Ayrıl ve hemen aynı kanala tekrar katıl: SUBSCRIBED ve hello gerçekleşir', async () => {
    let ac
    h.rt.removeGate = new Promise((r) => { ac = r })
    const kur = () => new PeerMesh({ channelId: 'k1', userId: 'aaa', localStream: null, iceServers: [], signal: supabaseSignal })
    const m1 = kur()
    m1.join()
    await akit()
    m1.leave()
    const m2 = kur()
    let hazir = 0
    m2.on('ready', () => hazir++)
    m2.join()
    await akit()
    ac() // sunucu ayrılmayı onayladı
    await akit()
    expect(hazir).toBe(1)
    const yeni = h.rt.created[1]
    expect(yeni).toBeDefined()
    expect(yeni.sent.map((m) => m.event)).toEqual(['hello'])
    m2.leave()
  })
})
