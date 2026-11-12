// Sunucu olayları (serverEvents.js): her sunucu için private server:<id> konusu, liste değişince yenilenir.
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

async function akit() { for (let i = 0; i < 20; i++) await Promise.resolve() }
const kanal = (sid) => h.rt.channels.find((c) => c.topic === `server:${sid}`)

beforeEach(() => { h.rt = createFakeRealtime() })

describe('subscribeServerEvents', () => {
  it('her sunucu için private server:<id> konusunu dinler, "degisti" olayını iletir', async () => {
    const gelen = []
    const s = subscribeServerEvents(['s1', 's2'], (sid, p) => gelen.push([sid, p]))
    await akit()
    expect(h.rt.channels.map((c) => c.topic).sort()).toEqual(['server:s1', 'server:s2'])
    for (const c of h.rt.channels) {
      expect(c.params.config.private).toBe(true)
      expect(c.handlers.map((x) => x.event)).toEqual(['degisti'])
    }
    kanal('s2').deliver('degisti', { tablo: 'channels', islem: 'DELETE', server_id: 's2', channel_id: 'c9' })
    expect(gelen).toEqual([['s2', { tablo: 'channels', islem: 'DELETE', server_id: 's2', channel_id: 'c9' }]])
    s.close()
  })

  it('istemci bu konuya hiçbir şey göndermez', async () => {
    const s = subscribeServerEvents(['s1'], () => {})
    await akit()
    expect(kanal('s1').sent).toEqual([])
    s.close()
  })

  it('liste değişince: çıkan sunucunun konusu kapanır, yeni gelenin açılır, kalan dokunulmaz', async () => {
    const gelen = []
    const s = subscribeServerEvents(['s1', 's2'], (sid) => gelen.push(sid))
    await akit()
    const eskiS1 = kanal('s1')
    const eskiS2 = kanal('s2')
    s.update(['s1', 's3'])
    await akit()
    expect(h.rt.channels.map((c) => c.topic).sort()).toEqual(['server:s1', 'server:s3'])
    expect(kanal('s1')).toBe(eskiS1)
    eskiS2.deliver('degisti', {}) // kapatılmış konudan gelen olay iletilmez
    expect(gelen).toEqual([])
    s.close()
    await akit()
    expect(h.rt.channels).toEqual([])
  })

  it('yeniden bağlanınca (2. SUBSCRIBED) kaçan olay olabilir: { yeniden: true } bildirilir', async () => {
    const gelen = []
    const s = subscribeServerEvents(['s1'], (sid, p) => gelen.push([sid, p]))
    await akit()
    expect(gelen).toEqual([]) // ilk bağlanış bildirilmez
    kanal('s1').cb('SUBSCRIBED')
    expect(gelen).toEqual([['s1', { yeniden: true }]])
    s.close()
  })

  it('close() sonrası olay iletilmez', async () => {
    const gelen = []
    const s = subscribeServerEvents(['s1'], (sid) => gelen.push(sid))
    await akit()
    const k = kanal('s1')
    s.close()
    k.deliver('degisti', {})
    expect(gelen).toEqual([])
  })
})
