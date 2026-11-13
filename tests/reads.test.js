// Okunmamış sayacı (reads.js): unread_counts, mark_read birleştirmesi ve tek abonelik.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.kanallar = []
  fake.removed = []
  fake.channel = vi.fn((konu) => {
    const k = { konu, ons: [], subCb: null }
    k.on = (_t, f, cb) => { k.ons.push({ ...f, cb }); return k }
    k.subscribe = (cb) => { k.subCb = cb; return k }
    fake.kanallar.push(k)
    return k
  })
  return {
    supabase: {
      rpc: (...a) => fake.rpc(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (k) => { fake.removed.push(k) },
    },
  }
})

import { fetchUnreadCounts, markRead, flushReads, resetReads, subscribeAllMessages } from '../src/data/reads.js'

const akit = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const markCalls = () => fake.rpc.mock.calls.filter((c) => c[0] === 'mark_read').map((c) => c[1])

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  fake.kanallar = []
  fake.removed = []
  resetReads()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

describe('fetchUnreadCounts', () => {
  it('unread_counts RPCsini çağırır, kanal -> { serverId, count } haritası döner', async () => {
    fake.rpc.mockImplementation(async () => ({
      data: [{ channel_id: 'c1', server_id: 's1', count: 3 }, { channel_id: 'c2', server_id: 's1', count: 0 }],
      error: null,
    }))
    const m = await fetchUnreadCounts()
    expect(fake.rpc).toHaveBeenCalledWith('unread_counts')
    expect([...m]).toEqual([['c1', { serverId: 's1', count: 3, mentions: 0 }], ['c2', { serverId: 's1', count: 0, mentions: 0 }]])
  })
  it('mentions sütununu taşır (007); eski şemada yoksa 0', async () => {
    fake.rpc.mockImplementation(async () => ({
      data: [{ channel_id: 'c1', server_id: 's1', count: 4, mentions: 2 }, { channel_id: 'c2', server_id: 's2', count: 1 }],
      error: null,
    }))
    const m = await fetchUnreadCounts()
    expect(m.get('c1')).toEqual({ serverId: 's1', count: 4, mentions: 2 })
    expect(m.get('c2')).toEqual({ serverId: 's2', count: 1, mentions: 0 })
  })
  it('hatada fırlatır', async () => {
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'olmadı' } }))
    await expect(fetchUnreadCounts()).rejects.toThrow('olmadı')
  })
})

describe('markRead', () => {
  it('1 sn içindeki çağrılar birleşir: kanal başına en büyük id tek yazmada gider', async () => {
    markRead('c1', 5)
    markRead('c1', 9)
    markRead('c1', 7) // geri gitmez
    markRead('c2', 3)
    vi.advanceTimersByTime(999)
    expect(markCalls()).toEqual([])
    vi.advanceTimersByTime(1)
    await akit()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 9 }, { cid: 'c2', mid: 3 }])
  })

  it('yalnız ileri gider: gönderilenden küçük ya da eşit id yeniden yazılmaz', async () => {
    markRead('c1', 10)
    vi.advanceTimersByTime(1000)
    await akit()
    markRead('c1', 10)
    markRead('c1', 4)
    vi.advanceTimersByTime(5000)
    await akit()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 10 }])
    markRead('c1', 11)
    vi.advanceTimersByTime(1000)
    await akit()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 10 }, { cid: 'c1', mid: 11 }])
  })

  it('yazmalar arası en az 1 sn: hemen ardından gelen çağrı bir sonraki pencereyi bekler', async () => {
    markRead('c1', 1)
    vi.advanceTimersByTime(1000)
    await akit()
    markRead('c1', 2)
    vi.advanceTimersByTime(500)
    await akit()
    expect(markCalls()).toHaveLength(1)
    vi.advanceTimersByTime(500)
    await akit()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 1 }, { cid: 'c1', mid: 2 }])
  })

  it('yazma başarısız olursa aynı id sonra yeniden denenebilir', async () => {
    fake.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'ağ' } }))
    markRead('c1', 8)
    vi.advanceTimersByTime(1000)
    await akit()
    markRead('c1', 8)
    vi.advanceTimersByTime(1000)
    await akit()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 8 }, { cid: 'c1', mid: 8 }])
  })

  it('flushReads beklemeden yazar', async () => {
    markRead('c1', 3)
    await flushReads()
    expect(markCalls()).toEqual([{ cid: 'c1', mid: 3 }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('geçersiz argüman yok sayılır', async () => {
    markRead(null, 3)
    markRead('c1', null)
    markRead('c1', 'abc')
    vi.advanceTimersByTime(2000)
    await akit()
    expect(markCalls()).toEqual([])
  })
})

describe('subscribeAllMessages', () => {
  it('süzgeçsiz tek abonelik: INSERT ve UPDATE iletilir, yeniden bağlanınca onReconnect', () => {
    const ins = []
    const upd = []
    let yeniden = 0
    const kapat = subscribeAllMessages({ onInsert: (m) => ins.push(m.id), onUpdate: (m) => upd.push(m.id), onReconnect: () => yeniden++ })
    expect(fake.kanallar).toHaveLength(1)
    const k = fake.kanallar[0]
    expect(k.ons.map((o) => o.event)).toEqual(['INSERT', 'UPDATE'])
    for (const o of k.ons) {
      expect(o).toMatchObject({ schema: 'public', table: 'messages' })
      expect(o.filter).toBeUndefined()
    }
    k.ons[0].cb({ new: { id: 1 } })
    k.ons[1].cb({ new: { id: 1, deleted_at: 'x' } })
    expect(ins).toEqual([1])
    expect(upd).toEqual([1])
    k.subCb('SUBSCRIBED')
    expect(yeniden).toBe(0)
    k.subCb('CHANNEL_ERROR')
    k.subCb('SUBSCRIBED')
    expect(yeniden).toBe(1)
    kapat()
    expect(fake.removed).toEqual([k])
    k.ons[0].cb({ new: { id: 2 } })
    expect(ins).toEqual([1])
  })
})
