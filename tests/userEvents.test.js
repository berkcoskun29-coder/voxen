// Kişiye özel olaylar (userEvents.js): private user:<id> konusu, tek abonelik, yalnız dinler.
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

import { subscribeUserEvents } from '../src/data/userEvents.js'

async function akit() { for (let i = 0; i < 20; i++) await Promise.resolve() }

beforeEach(() => { h.rt = createFakeRealtime() })

describe('subscribeUserEvents', () => {
  it('private user:<id> konusunu dinler, "degisti" olayını iletir', async () => {
    const gelen = []
    const s = subscribeUserEvents('u1', (p) => gelen.push(p))
    await akit()
    expect(h.rt.channels.map((c) => c.topic)).toEqual(['user:u1'])
    const k = h.rt.channels[0]
    expect(k.params.config.private).toBe(true)
    expect(k.handlers.map((x) => x.event)).toEqual(['degisti'])
    expect(h.rt.setAuthCalls).toBe(1) // private kanal güncel anahtarla açılır
    k.deliver('degisti', { tablo: 'friendships', islem: 'INSERT' })
    expect(gelen).toEqual([{ tablo: 'friendships', islem: 'INSERT' }])
    await s.close()
  })

  it('istemci bu konuya hiçbir şey göndermez; tek kanal açılır', async () => {
    const s = subscribeUserEvents('u1', () => {})
    await akit()
    expect(h.rt.created).toHaveLength(1)
    expect(h.rt.channels[0].sent).toEqual([])
    await s.close()
  })

  it('yeniden bağlanınca (2. SUBSCRIBED) { yeniden: true } bildirilir; ilk bağlanışta değil', async () => {
    const gelen = []
    const s = subscribeUserEvents('u1', (p) => gelen.push(p))
    await akit()
    expect(gelen).toEqual([])
    h.rt.channels[0].cb('SUBSCRIBED')
    expect(gelen).toEqual([{ yeniden: true }])
    await s.close()
  })

  it('kapanınca olay iletilmez ve kanal kaldırılır', async () => {
    const gelen = []
    const s = subscribeUserEvents('u1', (p) => gelen.push(p))
    await akit()
    const k = h.rt.channels[0]
    await s.close()
    k.deliver('degisti', {})
    expect(gelen).toEqual([])
    expect(h.rt.channels).toEqual([])
  })
})
