// @vitest-environment jsdom
// Grup DM sohbeti (v0.9.0): dmSource grup kaynağıyla mountChat — başlıkta grup rozeti ve adı, @bahsetme
// (öneri, etiket, vurgu), sistem satırı ('system') eylemsiz ve düzenlenemez. Ağ kullanılmaz (dmChat kalıbı).
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
import { dmSource, resetDmReads } from '../src/data/dms.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const can = { id: 'u3', username: 'can', color: null, avatar_url: null }
const grup = (ek = {}) => ({ id: 'g1', isGroup: true, name: null, ownerId: 'u1', members: [ben, ali, can], other: null, canSend: true, unread: 0, ...ek })
const satir = (id, author, content, ek = {}) => ({
  id, thread_id: 'g1', author_id: author, content, edited_at: null, deleted_at: null, kind: 'text',
  created_at: new Date(Date.UTC(2026, 10, 14, 10, 0) + id * 60000).toISOString(), ...ek,
})
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const ana = () => document.getElementById('main')
const yaz = (kutu, metin) => {
  kutu.value = metin
  kutu.setSelectionRange(metin.length, metin.length)
  kutu.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  fake.rows = { profiles: [ben, ali, can] }
  fake.sorgular = []
  fake.ons = []
  resetDmReads()
  document.body.innerHTML = '<div id="main"></div>'
})

describe('grup sohbeti', () => {
  it('başlıkta grup rozeti ve adı; başlangıç bloğu', async () => {
    fake.rows.dm_messages = []
    const s = mountChat(ana(), { source: dmSource(grup(), ben), profile: ben })
    await bosalt()
    expect(ana().querySelector('.main-header .group-badge')).not.toBeNull()
    expect(ana().querySelector('.header-name').textContent).toBe('ali, can')
    expect(ana().querySelector('.channel-start p').textContent).toBe('ali, can grubunun başlangıcı.')
    expect(ana().querySelector('textarea').placeholder).toBe('ali, can grubuna mesaj gönder')
    s.destroy()
  })

  it('@bahsetme: öneride üyeler, seni anan mesaj vurgulu, @ad etiketi', async () => {
    fake.rows.dm_messages = [satir(1, 'u2', 'selam @berk ve @can')]
    const s = mountChat(ana(), { source: dmSource(grup(), ben), profile: ben })
    await bosalt()
    expect(ana().querySelector('.message.mentioned')).not.toBeNull()
    expect([...ana().querySelectorAll('.mention')].map((e) => e.textContent)).toEqual(['@berk', '@can'])
    const kutu = ana().querySelector('.composer textarea')
    kutu.focus()
    yaz(kutu, '@al')
    const liste = ana().querySelector('.composer .mention-suggest')
    expect([...liste.querySelectorAll('.mention-option-name')].map((e) => e.textContent)).toEqual(['ali'])
    s.destroy()
  })

  it("sistem satırı ('system'): ortalanmış, eylemsiz, kimseyle gruplanmaz", async () => {
    fake.rows.dm_messages = [satir(1, 'u1', "berk, can'ı ekledi.", { kind: 'system' }), satir(2, 'u1', 'hoş geldin')]
    const s = mountChat(ana(), { source: dmSource(grup(), ben), profile: ben })
    await bosalt()
    const sistem = ana().querySelector('.message[data-id="1"]')
    expect(sistem.classList.contains('system-log')).toBe(true)
    expect(sistem.textContent).toBe("berk, can'ı ekledi.")
    expect(sistem.querySelector('button')).toBeNull()
    expect(ana().querySelector('.message[data-id="2"]').classList.contains('grouped')).toBe(false)
    s.destroy()
  })
})
