// "tepki" ve "sabit" yayınları var olan server:/user: konularından gelir (009): yeni abonelik açılmaz.
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

import { subscribeServerEvents } from '../src/data/serverEvents.js'
import { subscribeUserEvents } from '../src/data/userEvents.js'

async function akit() { for (let i = 0; i < 20; i++) await Promise.resolve() }
beforeEach(() => { h.rt = createFakeRealtime() })

describe('sunucu konusu', () => {
  it('onReaction/onPin verilince aynı server:<id> kanalında tepki ve sabit dinlenir', async () => {
    const tepkiler = []
    const sabitler = []
    const s = subscribeServerEvents(['s1'], () => {}, {
      onReaction: (sid, p) => tepkiler.push([sid, p]),
      onPin: (sid, p) => sabitler.push([sid, p]),
    })
    await akit()
    expect(h.rt.created).toHaveLength(1)
    const k = h.rt.channels[0]
    expect(k.topic).toBe('server:s1')
    expect(k.handlers.map((x) => x.event).sort()).toEqual(['degisti', 'sabit', 'tepki'])
    k.deliver('tepki', { channel_id: 'c1', message_id: 4, emoji: '👍', user_id: 'u2', islem: 'INSERT' })
    k.deliver('sabit', { channel_id: 'c1', message_id: 4, islem: 'DELETE' })
    expect(tepkiler).toEqual([['s1', { channel_id: 'c1', message_id: 4, emoji: '👍', user_id: 'u2', islem: 'INSERT' }]])
    expect(sabitler).toEqual([['s1', { channel_id: 'c1', message_id: 4, islem: 'DELETE' }]])
    s.close()
    k.deliver('tepki', {})
    expect(tepkiler).toHaveLength(1)
  })
})

describe('kişi konusu', () => {
  it('onReaction/onPin verilince user:<id> kanalında dinlenir; tek kanal', async () => {
    const tepkiler = []
    const sabitler = []
    const s = subscribeUserEvents('u1', () => {}, { onReaction: (p) => tepkiler.push(p), onPin: (p) => sabitler.push(p) })
    await akit()
    expect(h.rt.created).toHaveLength(1)
    const k = h.rt.channels[0]
    expect(k.handlers.map((x) => x.event).sort()).toEqual(['degisti', 'sabit', 'tepki'])
    k.deliver('tepki', { thread_id: 't1', message_id: 2 })
    k.deliver('sabit', { thread_id: 't1', message_id: 2 })
    expect(tepkiler).toEqual([{ thread_id: 't1', message_id: 2 }])
    expect(sabitler).toEqual([{ thread_id: 't1', message_id: 2 }])
    await s.close()
    k.deliver('sabit', {})
    expect(sabitler).toHaveLength(1)
  })
})
