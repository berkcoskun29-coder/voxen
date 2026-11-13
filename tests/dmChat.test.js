// @vitest-environment jsdom
// Özel mesaj sohbeti (sosyal T3): mountChat bir "kaynak" nesnesiyle çalışır (dmSource / channelSource).
// Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {} // tablo -> satırlar (id artan)
  fake.sorgular = [] // { tablo, eq: [[k, v]], before, after }
  fake.inserted = null // { tablo, deger }
  fake.insertResult = null // () => { data, error }
  fake.topics = []
  fake.ons = [] // { konu, event, filter, cb }
  fake.removed = 0
  fake.from = vi.fn((tablo) => {
    const d = { tablo, eq: [], before: null, after: null, asc: false, ids: null }
    const z = {
      select: () => z,
      eq: (k, v) => { d.eq.push([k, v]); return z },
      lt: (_k, v) => { d.before = v; return z },
      gt: (_k, v) => { d.after = v; return z },
      in: (_k, ids) => { d.ids = ids; return z },
      is: () => z,
      order: (_k, o) => { d.asc = !!o?.ascending; return z },
      limit: () => z,
      insert: (v) => { fake.inserted = { tablo, deger: v }; return z },
      single: async () => fake.insertResult(),
      then: (res) => {
        fake.sorgular.push(d)
        let satirlar = fake.rows[tablo] ?? []
        if (d.ids) satirlar = satirlar.filter((p) => d.ids.includes(p.id))
        if (!d.asc && !d.ids) satirlar = satirlar.slice().reverse()
        return Promise.resolve({ data: satirlar, error: null }).then(res)
      },
    }
    return z
  })
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.channel = vi.fn((konu) => {
    fake.topics.push(konu)
    const k = {
      on: (_t, f, cb) => { fake.ons.push({ konu, ...f, cb }); return k },
      subscribe: (cb) => { setTimeout(() => cb?.('SUBSCRIBED'), 0); return k },
      send: async () => 'ok',
    }
    return k
  })
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      rpc: (...a) => fake.rpc(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: async () => { fake.removed++ },
      realtime: { setAuth: async () => {} },
    },
  }
})

import { mountChat } from '../src/ui/chatView.js'
import { channelSource } from '../src/data/messages.js'
import { dmSource, resetDmReads, flushDmReads } from '../src/data/dms.js'
import { resetReads, flushReads } from '../src/data/reads.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const thread = (ek = {}) => ({ id: 't1', other: ali, createdAt: null, lastMessageAt: null, unread: 0, canSend: true, ...ek })
const dmMesaj = (id, author, content = `m${id}`) => ({
  id, thread_id: 't1', author_id: author, content, edited_at: null, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 13, 10, 0) + id * 60000).toISOString(),
})
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const ana = () => document.getElementById('main')
const mesaj = (id) => document.querySelector(`.message[data-id="${id}"]`)
const tus = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
const olay = (event) => fake.ons.find((o) => o.event === event && o.konu.startsWith('dm-messages:')).cb

async function dmKur(satirlar, { t = thread(), ...secenek } = {}) {
  fake.rows.dm_messages = satirlar
  const sohbet = mountChat(ana(), { source: dmSource(t, ben), profile: ben, ...secenek })
  await bosalt()
  return sohbet
}

beforeEach(() => {
  fake.rows = { profiles: [ben, ali] }
  fake.sorgular = []
  fake.topics = []
  fake.ons = []
  fake.inserted = null
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  resetDmReads()
  resetReads()
  document.body.innerHTML = '<div id="main"></div>'
})

describe('kaynak arayüzü', () => {
  it('kanal ve DM kaynakları aynı şekilde (aynı anahtarlar)', () => {
    const k = channelSource({ id: 'c1', name: 'genel' }, { isOwner: false, selfId: 'u1' })
    const d = dmSource(thread(), ben)
    expect(Object.keys(k).sort()).toEqual(Object.keys(d).sort())
    expect(k.kind).toBe('channel')
    expect(d.kind).toBe('dm')
    expect(k.placeholder).toBe('#genel kanalına mesaj yaz…')
    expect(d.placeholder).toBe('@ali kişisine mesaj gönder')
    expect(k.title).toBe('genel')
    expect(d.title).toBe('ali')
    expect(d.canSend).toBe(true)
    expect(dmSource(thread({ canSend: false }), ben).canSend).toBe(false)
  })

  it('silme izni: kanalda kendi mesajın ya da sahip; DM\'de yalnız kendi mesajın', () => {
    const uye = channelSource({ id: 'c1', name: 'genel' }, { selfId: 'u1' })
    const sahip = channelSource({ id: 'c1', name: 'genel' }, { isOwner: true, selfId: 'u1' })
    const d = dmSource(thread(), ben)
    expect(uye.canDelete({ author_id: 'u1' })).toBe(true)
    expect(uye.canDelete({ author_id: 'u2' })).toBe(false)
    expect(sahip.canDelete({ author_id: 'u2' })).toBe(true)
    expect(d.canDelete({ author_id: 'u1' })).toBe(true)
    expect(d.canDelete({ author_id: 'u2' })).toBe(false)
  })

  it('kanal kaynağı messages tablosunu ve mark_read\'i kullanır', async () => {
    const k = channelSource({ id: 'c1', name: 'genel' }, { selfId: 'u1' })
    fake.rows.messages = []
    await k.fetch(5, { limit: 50 })
    expect(fake.sorgular.at(-1)).toMatchObject({ tablo: 'messages', eq: [['channel_id', 'c1']], before: 5 })
    k.markRead(7)
    await flushReads()
    expect(fake.rpc).toHaveBeenCalledWith('mark_read', { cid: 'c1', mid: 7 })
  })
})

describe('DM sohbet ekranı', () => {
  it('başlıkta avatar + durum noktası + ad (# yok); kutuda "@ali kişisine mesaj gönder"', async () => {
    await dmKur([dmMesaj(1, 'u2')], { peerStatus: 'online' })
    const baslik = document.querySelector('.main-header')
    expect(baslik.querySelector('.header-hash')).toBeNull()
    expect(baslik.querySelector('.header-dm-avatar .status-dot').dataset.status).toBe('online')
    expect(baslik.querySelector('.header-avatar').textContent).toBe('A')
    expect(baslik.querySelector('.header-name').textContent).toBe('ali')
    expect(document.querySelector('textarea').placeholder).toBe('@ali kişisine mesaj gönder')
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'dm_messages', eq: [['thread_id', 't1']] })
  })

  it('durum değişince başlıktaki nokta güncellenir', async () => {
    const sohbet = await dmKur([])
    expect(document.querySelector('.header-dm-avatar .status-dot').dataset.status).toBe('offline')
    sohbet.setPeerStatus('dnd')
    expect(document.querySelectorAll('.header-dm-avatar').length).toBe(1)
    expect(document.querySelector('.header-dm-avatar .status-dot').dataset.status).toBe('dnd')
  })

  it('konuşmanın başlangıcında @ad bloğu', async () => {
    await dmKur([dmMesaj(1, 'u2')])
    const blok = document.querySelector('.channel-start')
    expect(blok.querySelector('.channel-start-icon').textContent).toBe('@')
    expect(blok.querySelector('h2').textContent).toBe('ali')
    expect(blok.querySelector('p').textContent).toBe('@ali ile özel mesajlarının başlangıcı.')
  })

  it('düzenleme ve silme yalnız kendi mesajında', async () => {
    await dmKur([dmMesaj(1, 'u1'), dmMesaj(2, 'u2')])
    expect([...mesaj(1).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))).toEqual(['Düzenle', 'Sil'])
    expect(mesaj(2).querySelector('.msg-actions')).toBeNull()
  })

  it('gönderme dm_messages\'e thread_id ile yazar', async () => {
    await dmKur([])
    fake.insertResult = () => ({ data: dmMesaj(9, 'u1', 'selam'), error: null })
    const kutu = document.querySelector('textarea')
    kutu.value = '  selam  '
    tus(kutu, 'Enter')
    await bosalt()
    expect(fake.inserted).toEqual({ tablo: 'dm_messages', deger: { thread_id: 't1', author_id: 'u1', content: 'selam' } })
    expect(mesaj(9).querySelector('.msg-text').textContent).toBe('selam')
    expect(kutu.value).toBe('')
  })

  it('veritabanı engel yüzünden reddederse "Bu kişiye mesaj gönderemezsin." toast\'ı; yazı silinmez', async () => {
    await dmKur([])
    fake.insertResult = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    const kutu = document.querySelector('textarea')
    kutu.value = 'selam'
    tus(kutu, 'Enter')
    await bosalt()
    expect(document.querySelector('.toast-hata').textContent).toContain('Bu kişiye mesaj gönderemezsin.')
    expect(kutu.value).toBe('selam')
  })

  it('↑ son kendi mesajını düzenlemeye açar; Enter edit_dm_message çağırır ve "(düzenlendi)" çıkar', async () => {
    await dmKur([dmMesaj(1, 'u1', 'eski'), dmMesaj(2, 'u2')])
    tus(document.querySelector('textarea'), 'ArrowUp')
    const kutu = document.querySelector('.msg-edit-input')
    expect(kutu.value).toBe('eski')
    fake.rpc.mockImplementation(async (ad, arg) => (ad === 'edit_dm_message'
      ? { data: { ...dmMesaj(1, 'u1', arg.yeni), edited_at: '2026-11-13T11:00:00Z' }, error: null }
      : { data: null, error: null }))
    kutu.value = 'yeni'
    tus(kutu, 'Enter')
    await bosalt()
    expect(fake.rpc).toHaveBeenCalledWith('edit_dm_message', { id: 1, yeni: 'yeni' })
    expect(mesaj(1).querySelector('.msg-text').textContent).toBe('yeni')
    expect(mesaj(1).querySelector('.msg-edited')).not.toBeNull()
  })

  it('Shift+🗑️ delete_dm_message ile siler', async () => {
    await dmKur([dmMesaj(1, 'u1')])
    mesaj(1).querySelector('[data-act="sil"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await bosalt()
    expect(fake.rpc).toHaveBeenCalledWith('delete_dm_message', { id: 1 })
    expect(mesaj(1)).toBeNull()
  })

  it('canlı: gelen mesaj eklenir, düzenleme yerinde değişir, silinen kalkar', async () => {
    await dmKur([dmMesaj(1, 'u2')])
    olay('INSERT')({ new: dmMesaj(2, 'u2', 'yeni geldi') })
    await bosalt()
    expect(mesaj(2).querySelector('.msg-text').textContent).toBe('yeni geldi')
    olay('UPDATE')({ new: { ...dmMesaj(2, 'u2', 'düzeldi'), edited_at: '2026-11-13T11:00:00Z' } })
    expect(mesaj(2).querySelector('.msg-text').textContent).toContain('düzeldi')
    olay('UPDATE')({ new: { ...dmMesaj(2, 'u2', ''), deleted_at: '2026-11-13T11:01:00Z' } })
    expect(mesaj(2)).toBeNull()
  })

  it('bağlantılar tıklanır link olur', async () => {
    await dmKur([dmMesaj(1, 'u2', 'bak https://example.com')])
    expect(mesaj(1).querySelector('.msg-link').textContent).toBe('https://example.com')
  })

  it('"yazıyor" konusu dm-typing:<konuşma>; destroy aboneliği kapatır', async () => {
    const sohbet = await dmKur([])
    expect(fake.topics).toContain('dm-typing:t1')
    expect(fake.topics.some((t) => t.startsWith('dm-messages:t1:'))).toBe(true)
    const once = fake.removed
    sohbet.destroy()
    await bosalt()
    expect(fake.removed).toBe(once + 2) // mesaj aboneliği + yazıyor kanalı
  })

  it('okundu işareti mark_dm_read ile', async () => {
    const d = dmSource(thread(), ben)
    d.markRead(4)
    await flushDmReads()
    expect(fake.rpc).toHaveBeenCalledWith('mark_dm_read', { tid: 't1', mid: 4 })
  })
})

describe('engel (can_send=false)', () => {
  it('kutu kapanır, yerine "Bu kişiye mesaj gönderemezsin."; eski mesajlar görünür; yazıyor konusuna katılmaz', async () => {
    await dmKur([dmMesaj(1, 'u2', 'eski mesaj'), dmMesaj(2, 'u1')], { t: thread({ canSend: false }) })
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('.composer-blocked').textContent).toBe('Bu kişiye mesaj gönderemezsin.')
    expect(mesaj(1).querySelector('.msg-text').textContent).toBe('eski mesaj')
    expect(fake.topics.some((t) => t.startsWith('dm-typing:'))).toBe(false)
  })
  it('kendi mesajında ✏️ yok (düzenleme kapalı), silme kalır', async () => {
    await dmKur([dmMesaj(1, 'u2', 'eski mesaj'), dmMesaj(2, 'u1')], { t: thread({ canSend: false }) })
    expect([...mesaj(2).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))).toEqual(['Sil'])
    expect(document.querySelector('.msg-edit')).toBeNull()
  })
})
