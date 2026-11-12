// @vitest-environment jsdom
// Varlık kanalı (presence:voxen): realtime-js'in "aynı konu = aynı kanal nesnesi" davranışına karşı
// ve özel (private) kanal yetkisi. Sahte realtime: tests/fakes/realtime.js
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

import { startPresence } from '../src/presence/presence.js'

async function akit() { for (let i = 0; i < 60; i++) await Promise.resolve() }
const tercih = () => ({ dnd: false, statusText: '' })

beforeEach(() => { h.rt = createFakeRealtime() })

describe('varlık kanalı', () => {
  it('özel (private) kanal açar; abone olmadan önce oturum anahtarını (JWT) yeniler', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    const k = h.rt.created[0]
    expect(k.topic).toBe('presence:voxen')
    expect(k.params.config.private).toBe(true)
    expect(k.params.config.presence.key).toBe('u1')
    expect(h.rt.log.slice(0, 2)).toEqual(['setAuth', 'channel'])
    expect(k.tracked.at(-1)).toMatchObject({ status: 'online' })
    await p.stop()
  })

  it('stop() kanal tamamen bırakılınca biten bir Promise döner', async () => {
    const p = startPresence('u1', tercih)
    await akit()
    let bitti = false
    p.stop().then(() => { bitti = true })
    expect(h.rt.channels).toHaveLength(1)
    await akit()
    expect(bitti).toBe(true)
    expect(h.rt.channels).toHaveLength(0)
  })

  it('kapanış bitmeden yeniden başlarsa (çıkış/giriş) önce kapanışı bekler, TAZE kanal açar ve yayınlar', async () => {
    let ac
    h.rt.removeGate = new Promise((r) => { ac = r })
    const p1 = startPresence('u1', tercih)
    await akit()
    p1.stop()
    const p2 = startPresence('u1', tercih)
    await akit()
    expect(h.rt.created).toHaveLength(1) // eski kanal hâlâ ayrılıyor: yenisi beklemede
    ac()
    await akit()
    expect(h.rt.created).toHaveLength(2)
    const yeni = h.rt.created[1]
    expect(yeni).not.toBe(h.rt.created[0])
    expect(yeni.state).toBe('joined')
    expect(yeni.tracked.at(-1)).toMatchObject({ status: 'online' })
    await p2.stop()
  })

  it('kanal kurulmadan durdurulursa hiç kanal açılmaz', async () => {
    const p = startPresence('u1', tercih)
    await p.stop()
    await akit()
    expect(h.rt.channels).toHaveLength(0)
  })
})
