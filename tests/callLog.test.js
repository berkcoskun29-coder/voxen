// @vitest-environment jsdom
// Arama kaydı satırları (DM, kind 'call'): ortalanmış sistem satırı, gruplanmaz, eylem simgesi yok.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.rows = {}
  fake.from = vi.fn((tablo) => {
    const z = {
      select: () => z, eq: () => z, lt: () => z, gt: () => z, in: () => z, is: () => z, order: () => z, limit: () => z,
      then: (res) => Promise.resolve({ data: (fake.rows[tablo] ?? []).slice().reverse(), error: null }).then(res),
    }
    return z
  })
  fake.channel = vi.fn(() => {
    const k = { on: () => k, subscribe: (cb) => { setTimeout(() => cb?.('SUBSCRIBED'), 0); return k }, send: async () => 'ok' }
    return k
  })
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      channel: (...a) => fake.channel(...a),
      removeChannel: async () => {},
      realtime: { setAuth: async () => {} },
    },
  }
})

import { renderMessage, mountChat } from '../src/ui/chatView.js'
import { dmSource, resetDmReads } from '../src/data/dms.js'
import { shouldNotify } from '../src/notify.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const zaman = (dk) => new Date(Date.UTC(2026, 10, 13, 10, dk)).toISOString()
const mesaj = (id, author, ek = {}) => ({
  id, thread_id: 't1', author_id: author, content: `m${id}`, edited_at: null, deleted_at: null, kind: 'text', created_at: zaman(id), ...ek,
})
const arama = (id, author, content = '📞 Cevapsız arama') => mesaj(id, author, { kind: 'call', content })
const bosalt = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  fake.rows = { profiles: [ben, ali] }
  resetDmReads()
  document.body.innerHTML = '<div id="main"></div>'
})

describe('renderMessage: kind call', () => {
  it('ortalanmış sistem satırı: metin var, avatar/ad/saat ve ✏️🗑️ yok', () => {
    const el = renderMessage(arama(5, 'u2', '📞 Arama · 12:34'), ali, {
      izin: { duzenle: true, sil: true }, tik: { onEdit() {}, onDelete() {} },
    })
    expect(el.classList.contains('call-log')).toBe(true)
    expect(el.dataset.id).toBe('5')
    expect(el.textContent).toBe('📞 Arama · 12:34')
    expect(el.querySelector('.msg-avatar, .msg-author, .msg-head, .msg-time')).toBeNull()
    expect(el.querySelector('button')).toBeNull()
  })

  it('içerik textContent ile yazılır (işaretleme çalışmaz)', () => {
    const el = renderMessage(arama(6, 'u2', '<b>x</b>'), ali)
    expect(el.querySelector('b')).toBeNull()
    expect(el.textContent).toBe('<b>x</b>')
  })
})

describe('mountChat: DM akışında arama satırı', () => {
  async function kur(satirlar) {
    fake.rows.dm_messages = satirlar
    mountChat(document.getElementById('main'), {
      source: dmSource({ id: 't1', other: ali, canSend: true }, ben), profile: ben,
    })
    await bosalt()
  }
  const satir = (id) => document.querySelector(`.message[data-id="${id}"]`)

  it('kendi arama satırında bile ✏️ ve 🗑️ çıkmaz; normal mesajda çıkar', async () => {
    await kur([mesaj(1, 'u1'), arama(2, 'u1')])
    expect(satir(2).querySelector('[data-act]')).toBeNull()
    expect(satir(1).querySelector('[data-act]')).not.toBeNull()
  })

  it('arama satırı komşularıyla gruplanmaz: sonraki normal mesaj başlığını yeniden çizer', async () => {
    await kur([mesaj(1, 'u2'), arama(2, 'u2'), mesaj(3, 'u2')])
    expect(satir(1).classList.contains('grouped')).toBe(false)
    expect(satir(3).classList.contains('grouped')).toBe(false)
    expect(satir(3).querySelector('.msg-author').textContent).toBe('ali')
    // Gün çizgisi arama satırı yüzünden yinelenmez
    expect(document.querySelectorAll('.day-separator')).toHaveLength(1)
  })

  it('arama satırından önce gelen normal mesajla gruplanma yine çalışır (arama yoksa)', async () => {
    await kur([mesaj(1, 'u2'), mesaj(2, 'u2')])
    expect(satir(2).classList.contains('grouped')).toBe(true)
  })
})

describe('okunmamış ve bildirim: arama satırı süzülmez', () => {
  it('shouldNotify arama satırına metin satırı gibi karar verir', () => {
    const girdi = { selfId: 'u1', odakta: false, acikHedef: null, durum: 'online', sessizSunucular: new Set(), ayarlar: {}, tur: 'dm' }
    expect(shouldNotify({ ...girdi, msg: arama(7, 'u2') })).toBe(true)
    expect(shouldNotify({ ...girdi, msg: mesaj(8, 'u2') })).toBe(true)
  })
})
