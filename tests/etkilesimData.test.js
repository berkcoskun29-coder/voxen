// Tepki, yanıt ve sabitleme veri katmanı (009): sorgu biçimleri, RPC adları/parametreleri, hata metinleri,
// kaynak nesnesi izinleri. Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))
vi.mock('../src/lib/supabase.js', () => {
  fake.sorgular = []
  fake.sonuc = () => ({ data: [], error: null })
  fake.from = (tablo) => {
    const d = { tablo, select: null, eq: [], in: null, order: null, limit: null, insert: null, is: [] }
    fake.sorgular.push(d)
    const z = {
      select: (s) => { d.select = s; return z },
      eq: (k, v) => { d.eq.push([k, v]); return z },
      in: (k, v) => { d.in = [k, v]; return z },
      is: (k, v) => { d.is.push([k, v]); return z },
      lt: () => z,
      gt: () => z,
      order: (k, o) => { d.order = [k, o]; return z },
      limit: (n) => { d.limit = n; return z },
      insert: (v) => { d.insert = v; return z },
      single: async () => fake.sonuc(d),
      then: (res) => Promise.resolve(fake.sonuc(d)).then(res),
    }
    return z
  }
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      rpc: (...a) => fake.rpc(...a),
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: async () => {},
    },
  }
})

import {
  fetchMessages, sendMessage, reactMessage, pinMessage, fetchPinnedMessages, fetchMessagesByIds,
  channelSource, MESAJ_SECIMI,
} from '../src/data/messages.js'
import {
  fetchDmMessages, sendDmMessage, reactDmMessage, pinDmMessage, fetchPinnedDmMessages, fetchDmMessagesByIds,
  dmSource, sistemSatiri, DM_MESAJ_SECIMI,
} from '../src/data/dms.js'
import { EMOJILER, gomuluTepkiler, gomuluSabit, etkilesimHatasi, SABIT_SINIRI } from '../src/data/reactions.js'

beforeEach(() => {
  fake.sorgular = []
  fake.sonuc = () => ({ data: [], error: null })
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
})

describe('mesaj sorgusu tepki ve sabit bilgisini gömer', () => {
  it("kanal: message_reactions, message_pins ve attachments", async () => {
    await fetchMessages('c1')
    expect(fake.sorgular[0].select).toBe(MESAJ_SECIMI)
    expect(MESAJ_SECIMI).toBe('*, reactions:message_reactions(emoji, user_id), pin:message_pins(pinned_at, pinned_by), attachments(id, path, name, mime, size, width, height, uploader)')
  })
  it('DM: dm_message_reactions ve dm_message_pins', async () => {
    await fetchDmMessages('t1')
    expect(fake.sorgular[0].select).toBe(DM_MESAJ_SECIMI)
    expect(DM_MESAJ_SECIMI).toBe('*, reactions:dm_message_reactions(emoji, user_id), pin:dm_message_pins(pinned_at, pinned_by), attachments(id, path, name, mime, size, width, height, uploader)')
  })
})

describe('yanıtla gönderme', () => {
  it('replyTo verilirse reply_to yazılır; verilmezse alan hiç yok (eski davranış)', async () => {
    fake.sonuc = (d) => ({ data: { id: 5, ...d.insert }, error: null })
    await sendMessage('c1', ' selam ', 'u1', { replyTo: 3 })
    expect(fake.sorgular[0].insert).toEqual({ channel_id: 'c1', author_id: 'u1', content: 'selam', reply_to: 3 })
    await sendMessage('c1', 'selam', 'u1')
    expect(fake.sorgular[1].insert).toEqual({ channel_id: 'c1', author_id: 'u1', content: 'selam' })
    await sendDmMessage('t1', 'x', 'u1', { replyTo: 9 })
    expect(fake.sorgular[2]).toMatchObject({ tablo: 'dm_messages', insert: { thread_id: 't1', author_id: 'u1', content: 'x', reply_to: 9 } })
    await sendDmMessage('t1', 'x', 'u1')
    expect(fake.sorgular[3].insert).toEqual({ thread_id: 't1', author_id: 'u1', content: 'x' })
  })
  it('kaynaklar send(content, { replyTo }) iletir', async () => {
    fake.sonuc = (d) => ({ data: { id: 5, ...d.insert }, error: null })
    await channelSource({ id: 'c1', name: 'genel' }, { selfId: 'u1' }).send('a', { replyTo: 2 })
    expect(fake.sorgular[0].insert.reply_to).toBe(2)
    await dmSource({ id: 't1', other: { username: 'ali' } }, { id: 'u1' }).send('a', { replyTo: 4 })
    expect(fake.sorgular[1].insert.reply_to).toBe(4)
  })
})

describe('tepki ve sabit RPC\'leri', () => {
  it('parametre adları: mid, tepki, ekle / mid, sabitle', async () => {
    await reactMessage(7, '👍', true)
    expect(fake.rpc).toHaveBeenLastCalledWith('react_message', { mid: 7, tepki: '👍', ekle: true })
    await reactDmMessage(8, '❤️', false)
    expect(fake.rpc).toHaveBeenLastCalledWith('react_dm_message', { mid: 8, tepki: '❤️', ekle: false })
    await pinMessage(7, true)
    expect(fake.rpc).toHaveBeenLastCalledWith('pin_message', { mid: 7, sabitle: true })
    await pinDmMessage(8, false)
    expect(fake.rpc).toHaveBeenLastCalledWith('pin_dm_message', { mid: 8, sabitle: false })
  })
  it('PIN_LIMIT -> "En fazla 50 mesaj sabitlenebilir."; engel kodları aynı metin (bilgi sızmaz)', async () => {
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'PIN_LIMIT' } }))
    await expect(pinMessage(1, true)).rejects.toThrow('En fazla 50 mesaj sabitlenebilir.')
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'BLOCKED_DM' } }))
    const e1 = await reactDmMessage(1, '👍', true).catch((e) => e)
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'NOT_ALLOWED' } }))
    const e2 = await reactDmMessage(1, '👍', true).catch((e) => e)
    expect(e1.message).toBe(e2.message)
    expect(e1.message).toBe('Bunu yapamazsın.')
    expect(etkilesimHatasi({ message: 'baska' }).code).toBe(null)
    expect(SABIT_SINIRI).toBe(50)
  })
})

describe('sabit listesi ve alıntı sorguları', () => {
  it('kanal sabitleri: message_pins, en yeni üstte, 50; satırlar mesaja çevrilir, silinmiş süzülür', async () => {
    fake.sonuc = () => ({
      data: [
        { pinned_at: '2026-11-14T10:00:00Z', pinned_by: 'u1', message: { id: 3, content: 'üç', deleted_at: null } },
        { pinned_at: '2026-11-14T09:00:00Z', pinned_by: 'u1', message: { id: 2, content: '', deleted_at: '2026-11-14T09:30:00Z' } },
        { pinned_at: '2026-11-14T08:00:00Z', pinned_by: 'u2', message: null },
      ],
      error: null,
    })
    const liste = await fetchPinnedMessages('c1')
    const d = fake.sorgular[0]
    expect(d).toMatchObject({ tablo: 'message_pins', select: 'pinned_at, pinned_by, message:messages(*)', limit: 50 })
    expect(d.eq).toEqual([['channel_id', 'c1']])
    expect(d.order).toEqual(['pinned_at', { ascending: false }])
    expect(liste).toEqual([{ id: 3, content: 'üç', deleted_at: null, pinned_at: '2026-11-14T10:00:00Z', pinned_by: 'u1' }])
  })
  it('DM sabitleri: dm_message_pins, thread_id', async () => {
    await fetchPinnedDmMessages('t1')
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'dm_message_pins', select: 'pinned_at, pinned_by, message:dm_messages(*)' })
    expect(fake.sorgular[0].eq).toEqual([['thread_id', 't1']])
  })
  it('alıntı: id ile getirir (silinmiş süzgeci YOK); boş listede sorgu atmaz', async () => {
    expect(await fetchMessagesByIds([])).toEqual([])
    expect(fake.sorgular).toHaveLength(0)
    await fetchMessagesByIds([1, 2])
    expect(fake.sorgular[0]).toMatchObject({ tablo: 'messages', in: ['id', [1, 2]], is: [] })
    await fetchDmMessagesByIds([4])
    expect(fake.sorgular[1]).toMatchObject({ tablo: 'dm_messages', in: ['id', [4]], is: [] })
  })
})

describe('kaynak izinleri', () => {
  const kanal = (isOwner) => channelSource({ id: 'c1', name: 'genel' }, { isOwner, selfId: 'u1' })
  const dm = (canSend = true) => dmSource({ id: 't1', other: { username: 'ali' }, canSend }, { id: 'u1' })
  it('kanal: her üye tepki verir; yalnız sahip sabitler', () => {
    expect(kanal(false).canReact({ id: 1 })).toBe(true)
    expect(kanal(false).canPin({ id: 1 })).toBe(false)
    expect(kanal(true).canPin({ id: 1 })).toBe(true)
  })
  it('DM: iki taraf tepki verir ve sabitler; engelde ve sistem satırında hayır', () => {
    expect(dm().canReact({ id: 1, kind: 'text' })).toBe(true)
    expect(dm().canPin({ id: 1 })).toBe(true)
    expect(dm(false).canReact({ id: 1 })).toBe(false)
    expect(dm(false).canPin({ id: 1 })).toBe(false)
    for (const kind of ['call', 'pin']) {
      expect(dm().canReact({ id: 1, kind })).toBe(false)
      expect(dm().canPin({ id: 1, kind })).toBe(false)
    }
  })
  it("DM: 'pin' satırı da düzenlenemez ve silinemez (yazarı ben olsam da)", () => {
    expect(sistemSatiri({ kind: 'pin' })).toBe(true)
    expect(dm().canEdit({ author_id: 'u1', kind: 'pin' })).toBe(false)
    expect(dm().canDelete({ author_id: 'u1', kind: 'pin' })).toBe(false)
    expect(dm().canEdit({ author_id: 'u1', kind: 'text' })).toBe(true)
  })
  it('kaynaklar react/pin/fetchPinned/fetchByIds sağlar', async () => {
    const k = kanal(true)
    await k.react(1, '🔥', true)
    expect(fake.rpc).toHaveBeenLastCalledWith('react_message', { mid: 1, tepki: '🔥', ekle: true })
    await k.pin(1, false)
    expect(fake.rpc).toHaveBeenLastCalledWith('pin_message', { mid: 1, sabitle: false })
    const d = dm()
    await d.react(2, '🎉', true)
    expect(fake.rpc).toHaveBeenLastCalledWith('react_dm_message', { mid: 2, tepki: '🎉', ekle: true })
    await d.pin(2, true)
    expect(fake.rpc).toHaveBeenLastCalledWith('pin_dm_message', { mid: 2, sabitle: true })
    expect(typeof k.fetchPinned).toBe('function')
    expect(typeof d.fetchByIds).toBe('function')
  })
})

describe('gömülü alanların ayrıştırılması', () => {
  it('tepkiler: dizi değilse null (bilgi yok); geçersiz emoji atılır', () => {
    expect(gomuluTepkiler({ id: 1 })).toBe(null)
    expect(gomuluTepkiler({ reactions: [{ emoji: '👍', user_id: 'u1' }, { emoji: '🤡', user_id: 'u2' }] }))
      .toEqual([{ emoji: '👍', user_id: 'u1' }])
    expect(EMOJILER).toHaveLength(8)
  })
  it('sabit: alan yoksa undefined; null; nesne ya da dizi', () => {
    expect(gomuluSabit({ id: 1 })).toBe(undefined)
    expect(gomuluSabit({ pin: null })).toBe(null)
    expect(gomuluSabit({ pin: { pinned_at: 'x', pinned_by: 'u1' } })).toEqual({ pinned_at: 'x', pinned_by: 'u1' })
    expect(gomuluSabit({ pin: [] })).toBe(null)
    expect(gomuluSabit({ pin: [{ pinned_at: 'y' }] })).toEqual({ pinned_at: 'y' })
  })
})
