// Özel mesaj (dms.js): RPC adları, hata metinleri, tek DM aboneliği (UPDATE iletilir),
// markDmRead birleştirmesi / yalnız ileri, dmSource arayüzü.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.kanallar = []
  fake.removed = []
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
  fake.channel = vi.fn((konu, params) => {
    const k = { konu, params, ons: [], subCb: null, sent: [] }
    k.on = (t, f, cb) => { k.ons.push({ tur: t, ...f, cb }); return k }
    k.subscribe = (cb) => { k.subCb = cb; return k }
    k.send = async (m) => { k.sent.push(m); return 'ok' }
    fake.kanallar.push(k)
    return k
  })
  fake.from = vi.fn((tablo) => {
    const s = { tablo, cagrilar: [] }
    for (const ad of ['select', 'eq', 'is', 'gt', 'lt', 'order', 'limit', 'insert', 'single']) {
      s[ad] = (...a) => { s.cagrilar.push([ad, ...a]); return s }
    }
    s.then = (ok, hata) => Promise.resolve(fake.sonuc).then(ok, hata)
    fake.sorgular.push(s)
    return s
  })
  return {
    supabase: {
      rpc: (...a) => fake.rpc(...a),
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: async (k) => { fake.removed.push(k) },
      realtime: { setAuth: async () => {} },
    },
  }
})

import {
  fetchDmList, openDm, hideDm, fetchDmMessages, sendDmMessage, editDmMessage, deleteDmMessage,
  subscribeAllDmMessages, subscribeDmMessages, markDmRead, flushDmReads, resetDmReads, dmSource, aramaSatiri,
} from '../src/data/dms.js'
import { markRead, resetReads } from '../src/data/reads.js'

const akit = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const rpcCalls = (ad) => fake.rpc.mock.calls.filter((c) => c[0] === ad).map((c) => c[1])

beforeEach(() => {
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  fake.kanallar = []
  fake.removed = []
  fake.sorgular = []
  fake.sonuc = { data: [], error: null }
  resetDmReads()
  resetReads()
})

describe('liste, açma, gizleme', () => {
  it('fetchDmList: dm_list satırlarını konuşma nesnesine çevirir', async () => {
    fake.rpc.mockImplementation(async () => ({
      data: [{
        thread_id: 't1', other_id: 'u2', username: 'ayla', color: '#3be37a', avatar_url: null,
        created_at: '2026-11-13T10:00:00Z', last_message_at: '2026-11-13T11:00:00Z', unread: 3, can_send: true,
      }, {
        thread_id: 't2', other_id: 'u3', username: 'kerem', color: '#5b7cfa', avatar_url: 'https://x',
        created_at: '2026-11-12T10:00:00Z', last_message_at: null, unread: 0, can_send: false,
      }],
      error: null,
    }))
    const l = await fetchDmList()
    expect(fake.rpc).toHaveBeenCalledWith('dm_list')
    expect(l[0]).toEqual({
      id: 't1', other: { id: 'u2', username: 'ayla', color: '#3be37a', avatar_url: null },
      createdAt: '2026-11-13T10:00:00Z', lastMessageAt: '2026-11-13T11:00:00Z', unread: 3, canSend: true,
    })
    expect(l[1].canSend).toBe(false)
  })

  it('openDm: open_dm({ other }) konuşma id döner; hideDm: hide_dm({ tid })', async () => {
    fake.rpc.mockImplementation(async (ad) => ({ data: ad === 'open_dm' ? 't9' : null, error: null }))
    expect(await openDm('u2')).toBe('t9')
    await hideDm('t9')
    expect(fake.rpc.mock.calls).toEqual([['open_dm', { other: 'u2' }], ['hide_dm', { tid: 't9' }]])
  })

  it('openDm hata kodları Türkçe metne çevrilir; engel ile izinsizlik aynı metin', async () => {
    for (const kod of ['NOT_ALLOWED', 'BLOCKED_DM']) {
      fake.rpc.mockImplementation(async () => ({ data: null, error: { message: kod } }))
      const e = await openDm('u2').catch((h) => h)
      expect(e.message).toBe('Bu kişiye mesaj gönderemezsin.')
    }
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'NO_USER' } }))
    expect((await openDm('u2').catch((h) => h)).message).toBe('Böyle bir kullanıcı yok.')
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'SELF' } }))
    expect((await openDm('ben').catch((h) => h)).message).toBe('Kendine mesaj gönderemezsin.')
  })
})

describe('mesajlar', () => {
  it('fetchDmMessages: dm_messages, thread_id süzgeci, silinmişler hariç, eskiden yeniye', async () => {
    fake.sonuc = { data: [{ id: 3 }, { id: 2 }], error: null }
    const m = await fetchDmMessages('t1', { before: 10 })
    expect(m.map((x) => x.id)).toEqual([2, 3])
    const q = fake.sorgular[0]
    expect(q.tablo).toBe('dm_messages')
    expect(q.cagrilar).toEqual(expect.arrayContaining([
      ['eq', 'thread_id', 't1'], ['is', 'deleted_at', null], ['lt', 'id', 10], ['order', 'id', { ascending: false }],
    ]))
  })

  it('fetchDmMessages: bütün sütunlar (008 kind dahil) seçilir, kind olduğu gibi gelir', async () => {
    fake.sonuc = { data: [{ id: 2, kind: 'call', content: '📞 Cevapsız arama' }], error: null }
    const m = await fetchDmMessages('t1')
    expect(fake.sorgular[0].cagrilar[0]).toEqual(['select', '*'])
    expect(m[0].kind).toBe('call')
  })

  it('sendDmMessage: kırpılmış içerikle INSERT; boş/uzun gönderilmez', async () => {
    fake.sonuc = { data: { id: 5, content: 'selam' }, error: null }
    expect(await sendDmMessage('t1', '  selam ', 'ben')).toEqual({ ok: true, message: { id: 5, content: 'selam' } })
    expect(fake.sorgular[0].cagrilar[0]).toEqual(['insert', { thread_id: 't1', author_id: 'ben', content: 'selam' }])
    expect(await sendDmMessage('t1', '   ', 'ben')).toEqual({ ok: false, warning: '' })
    expect((await sendDmMessage('t1', 'x'.repeat(2001), 'ben')).ok).toBe(false)
    expect(fake.sorgular).toHaveLength(1)
  })

  it('sendDmMessage: RLS reddi (engel) "Bu kişiye mesaj gönderemezsin." olur', async () => {
    fake.sonuc = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "dm_messages"' } }
    await expect(sendDmMessage('t1', 'selam', 'ben')).rejects.toThrow('Bu kişiye mesaj gönderemezsin.')
  })

  it('düzenleme ve silme RPC adları/argümanları', async () => {
    fake.rpc.mockImplementation(async (ad) => ({ data: ad === 'edit_dm_message' ? { id: 7, content: 'yeni' } : null, error: null }))
    expect(await editDmMessage(7, ' yeni ')).toEqual({ ok: true, message: { id: 7, content: 'yeni' } })
    await deleteDmMessage(7)
    expect(fake.rpc.mock.calls).toEqual([['edit_dm_message', { id: 7, yeni: 'yeni' }], ['delete_dm_message', { id: 7 }]])
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'BLOCKED_DM' } }))
    await expect(editDmMessage(7, 'x')).rejects.toThrow('Bu kişiye mesaj gönderemezsin.')
  })
})

describe('subscribeAllDmMessages: tek abonelik', () => {
  it('süzgeçsiz tek kanal; INSERT ve UPDATE iletilir', async () => {
    const ekle = []
    const guncelle = []
    const kapat = subscribeAllDmMessages({ onInsert: (m) => ekle.push(m), onUpdate: (m) => guncelle.push(m) })
    expect(fake.kanallar).toHaveLength(1)
    const k = fake.kanallar[0]
    expect(k.ons.map((o) => [o.tur, o.event, o.table, o.filter])).toEqual([
      ['postgres_changes', 'INSERT', 'dm_messages', undefined],
      ['postgres_changes', 'UPDATE', 'dm_messages', undefined],
    ])
    k.ons[0].cb({ new: { id: 1, thread_id: 't1' } })
    k.ons[1].cb({ new: { id: 1, thread_id: 't1', deleted_at: 'x', content: '' } })
    expect(ekle).toEqual([{ id: 1, thread_id: 't1' }])
    expect(guncelle).toEqual([{ id: 1, thread_id: 't1', deleted_at: 'x', content: '' }])
    kapat()
    expect(fake.removed).toEqual([k])
    k.ons[0].cb({ new: { id: 2 } }) // kapandıktan sonra iletilmez
    expect(ekle).toHaveLength(1)
  })

  it('yeniden bağlanınca (2. SUBSCRIBED) onReconnect; ilk bağlanışta değil', () => {
    const onReconnect = vi.fn()
    subscribeAllDmMessages({ onReconnect })
    const k = fake.kanallar[0]
    k.subCb('SUBSCRIBED')
    expect(onReconnect).not.toHaveBeenCalled()
    k.subCb('CHANNEL_ERROR')
    k.subCb('SUBSCRIBED')
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('her çağrı benzersiz konu alır (hızlı kapat/aç yarı kapanmış kanalı yeniden kullanmaz)', () => {
    subscribeAllDmMessages({})()
    subscribeAllDmMessages({})
    expect(fake.kanallar[0].konu).not.toBe(fake.kanallar[1].konu)
  })
})

describe('subscribeDmMessages (açık konuşma)', () => {
  it('thread_id süzgeci; UPDATE yalnız isteyene; yeniden bağlanınca geri doldurur', async () => {
    const ekle = []
    const onUpdate = vi.fn()
    subscribeDmMessages('t1', (m) => ekle.push(m.id), { onUpdate, getLastId: () => 4 })
    const k = fake.kanallar[0]
    expect(k.ons.map((o) => [o.event, o.filter])).toEqual([['INSERT', 'thread_id=eq.t1'], ['UPDATE', 'thread_id=eq.t1']])
    k.ons[1].cb({ new: { id: 2, edited_at: 'x' } })
    expect(onUpdate).toHaveBeenCalledWith({ id: 2, edited_at: 'x' })
    fake.sonuc = { data: [{ id: 5 }, { id: 6 }], error: null }
    k.subCb('SUBSCRIBED')
    k.subCb('SUBSCRIBED')
    await akit()
    expect(ekle).toEqual([5, 6])
    expect(fake.sorgular.at(-1).cagrilar).toEqual(expect.arrayContaining([['gt', 'id', 4]]))
  })
})

describe('markDmRead', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('1 sn içindeki çağrılar birleşir: konuşma başına en büyük id tek yazmada gider', async () => {
    markDmRead('t1', 5)
    markDmRead('t1', 9)
    markDmRead('t1', 7)
    markDmRead('t2', 3)
    vi.advanceTimersByTime(999)
    expect(rpcCalls('mark_dm_read')).toEqual([])
    vi.advanceTimersByTime(1)
    await akit()
    expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 't1', mid: 9 }, { tid: 't2', mid: 3 }])
  })

  it('yalnız ileri gider', async () => {
    markDmRead('t1', 10)
    vi.advanceTimersByTime(1000)
    await akit()
    markDmRead('t1', 10)
    markDmRead('t1', 4)
    vi.advanceTimersByTime(3000)
    await akit()
    expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 't1', mid: 10 }])
    markDmRead('t1', 12)
    await flushDmReads()
    expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 't1', mid: 10 }, { tid: 't1', mid: 12 }])
  })

  it('başarısız yazma yeniden denenebilir', async () => {
    fake.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'ağ' } }))
    markDmRead('t1', 8)
    vi.advanceTimersByTime(1000)
    await akit()
    markDmRead('t1', 8)
    vi.advanceTimersByTime(1000)
    await akit()
    expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 't1', mid: 8 }, { tid: 't1', mid: 8 }])
  })

  it('kanal okundu durumundan ayrıdır (aynı id iki yere ayrı gider)', async () => {
    markRead('x1', 5)
    markDmRead('x1', 5)
    vi.advanceTimersByTime(1000)
    await akit()
    expect(rpcCalls('mark_read')).toEqual([{ cid: 'x1', mid: 5 }])
    expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 'x1', mid: 5 }])
  })
})

describe('dmSource', () => {
  const thread = { id: 't1', other: { id: 'u2', username: 'ayla' } }
  const ben = { id: 'ben', username: 'berk' }

  it('arayüz alanları: kind, id, title, placeholder', () => {
    const s = dmSource(thread, ben)
    expect(s).toMatchObject({ kind: 'dm', id: 't1', title: 'ayla', placeholder: '@ayla kişisine mesaj gönder' })
    for (const f of ['fetch', 'send', 'edit', 'remove', 'subscribe', 'joinTyping', 'markRead', 'canDelete', 'canEdit']) {
      expect(typeof s[f]).toBe('function')
    }
  })

  it('canDelete: yalnız kendi mesajı (DM\'de sahip yok)', () => {
    const s = dmSource(thread, ben)
    expect(s.canDelete({ author_id: 'ben' })).toBe(true)
    expect(s.canDelete({ author_id: 'u2' })).toBe(false)
  })

  it("arama kaydı satırı (kind 'call'): yazarı ben olsam da silinemez ve düzenlenemez", () => {
    const s = dmSource(thread, ben)
    const arama = { author_id: 'ben', kind: 'call', content: '📞 Arama · 12:34' }
    expect(s.canDelete(arama)).toBe(false)
    expect(s.canEdit(arama)).toBe(false)
    expect(s.canEdit({ author_id: 'ben', kind: 'text' })).toBe(true)
    expect(s.canEdit({ author_id: 'ben' })).toBe(true) // eski şema: kind yok, düz mesaj
    expect(s.canEdit({ author_id: 'u2', kind: 'text' })).toBe(false)
    expect(aramaSatiri(arama)).toBe(true)
    expect(aramaSatiri({ kind: 'text' })).toBe(false)
  })

  it('fetch/send/edit/remove doğru tabloya ve RPC\'ye gider', async () => {
    const s = dmSource(thread, ben)
    fake.sonuc = { data: [], error: null }
    await s.fetch(20)
    expect(fake.sorgular[0].tablo).toBe('dm_messages')
    expect(fake.sorgular[0].cagrilar).toEqual(expect.arrayContaining([['eq', 'thread_id', 't1'], ['lt', 'id', 20]]))
    await s.fetch()
    expect(fake.sorgular[1].cagrilar.some((c) => c[0] === 'lt')).toBe(false)
    fake.sonuc = { data: { id: 1 }, error: null }
    await s.send('selam')
    expect(fake.sorgular[2].cagrilar[0]).toEqual(['insert', { thread_id: 't1', author_id: 'ben', content: 'selam' }])
    fake.rpc.mockImplementation(async () => ({ data: { id: 1 }, error: null }))
    await s.edit(1, 'yeni')
    await s.remove(1)
    expect(fake.rpc.mock.calls).toEqual([['edit_dm_message', { id: 1, yeni: 'yeni' }], ['delete_dm_message', { id: 1 }]])
  })

  it('subscribe konuşmanın kanalını açar, kapatma fonksiyonu döner', () => {
    const s = dmSource(thread, ben)
    const ekle = []
    const kapat = s.subscribe({ onInsert: (m) => ekle.push(m.id), onUpdate: () => {} })
    const k = fake.kanallar[0]
    expect(k.ons[0].filter).toBe('thread_id=eq.t1')
    k.ons[0].cb({ new: { id: 3 } })
    expect(ekle).toEqual([3])
    kapat()
    expect(fake.removed).toEqual([k])
  })

  it('joinTyping private dm-typing:<id> konusunu kullanır', async () => {
    const s = dmSource(thread, ben)
    const t = s.joinTyping({ selfId: 'ben', selfName: 'berk', onChange: () => {} })
    await akit()
    expect(fake.kanallar.map((k) => k.konu)).toEqual(['dm-typing:t1'])
    expect(fake.kanallar[0].params.config.private).toBe(true)
    await t.leave()
  })

  it('markRead mark_dm_read ile (birleştirilerek) yazar', async () => {
    vi.useFakeTimers()
    try {
      const s = dmSource(thread, ben)
      s.markRead(4)
      vi.advanceTimersByTime(1000)
      await akit()
      expect(rpcCalls('mark_dm_read')).toEqual([{ tid: 't1', mid: 4 }])
    } finally { vi.useRealTimers() }
  })
})
