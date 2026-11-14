// @vitest-environment jsdom
// Arama sonucundan mesaja gitme (v0.10.0): mountChat().goToMessage(id) — ilk yüklemeyi bekler, gerekirse
// mesajdan listenin başına kadar olanları ileri doğru yükler (liste kesintisiz), sonra kaydırır ve vurgular.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: () => {
      const z = { select: () => z, in: () => z, then: (res) => Promise.resolve({ data: [], error: null }).then(res) }
      return z
    },
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: async () => {},
  },
}))

import { mountChat } from '../src/ui/chatView.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ms = (id) => ({
  id, channel_id: 'c1', author_id: 'u1', content: `m${id}`, edited_at: null, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 14, 10, 0) + id * 60000).toISOString(),
})
const bosalt = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }

// Sahte kaynak: before (eskiler, sondan limit) ve after (sonrakiler, baştan limit) destekli
function kaynakKur(satirlar, ek = {}) {
  const k = {
    kind: 'channel', id: 'c1', title: 'genel', placeholder: 'yaz', other: null, canSend: true,
    fetch: vi.fn(async (before, { after, limit = 50 } = {}) => {
      const s = satirlar.filter((m) => !m.deleted_at)
      if (after != null) return s.filter((m) => m.id > after).slice(0, limit)
      return s.filter((m) => before == null || m.id < before).slice(-limit)
    }),
    send: vi.fn(), edit: vi.fn(), remove: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
    markRead: () => {},
    canDelete: () => false,
    canEdit: () => false,
    ...ek,
  }
  return k
}
const idler = () => [...document.querySelectorAll('.message')].map((e) => Number(e.dataset.id))

beforeEach(() => { document.body.innerHTML = '<div id="main"></div>' })

describe('goToMessage', () => {
  it('yüklü mesaja doğrudan gider ve vurgular', async () => {
    const kaynak = kaynakKur(Array.from({ length: 20 }, (_, i) => ms(i + 1)))
    const s = mountChat(document.getElementById('main'), { source: kaynak, profile: ben })
    await s.goToMessage(5) // ilk yükleme beklenir
    expect(document.querySelector('.message[data-id="5"]').classList.contains('flash')).toBe(true)
    s.destroy()
  })

  it('eski mesaj: bağlam + mesajdan listenin başına kadar yüklenir; liste kesintisiz', async () => {
    const satirlar = Array.from({ length: 600 }, (_, i) => ms(i + 1))
    const kaynak = kaynakKur(satirlar)
    const s = mountChat(document.getElementById('main'), { source: kaynak, profile: ben })
    await bosalt()
    expect(idler()[0]).toBe(551) // ilk sayfa: son 50
    await s.goToMessage(100)
    const l = idler()
    expect(l[0]).toBe(90) // 10 bağlam mesajı
    expect(l.at(-1)).toBe(600)
    expect(l.length).toBe(511) // 90..600 eksiksiz
    expect(l.every((id, i) => i === 0 || id === l[i - 1] + 1)).toBe(true)
    expect(document.querySelector('.message[data-id="100"]').classList.contains('flash')).toBe(true)
    // İleri yükleme 200'erli sayfalarla
    expect(kaynak.fetch.mock.calls.some(([b, o]) => b === null && o?.after === 99 && o?.limit === 200)).toBe(true)
    s.destroy()
  })

  it('konuşmanın başına ulaşılınca başlangıç bloğu görünür', async () => {
    const kaynak = kaynakKur(Array.from({ length: 80 }, (_, i) => ms(i + 1)))
    const s = mountChat(document.getElementById('main'), { source: kaynak, profile: ben })
    await s.goToMessage(3)
    expect(idler()[0]).toBe(1)
    expect(document.querySelector('.channel-start')).not.toBe(null)
    s.destroy()
  })

  it('2000 mesajdan uzaksa hiçbir şey eklenmez, uyarı çıkar', async () => {
    const kaynak = kaynakKur(Array.from({ length: 2600 }, (_, i) => ms(i + 1)))
    const s = mountChat(document.getElementById('main'), { source: kaynak, profile: ben })
    await bosalt()
    await s.goToMessage(10)
    expect(idler()[0]).toBe(2551)
    expect(document.querySelector('.toast')?.textContent).toContain('çok eskide')
    s.destroy()
  })

  it('silinmiş mesaj: "Mesaj bulunamadı"', async () => {
    const satirlar = Array.from({ length: 120 }, (_, i) => ms(i + 1))
    satirlar[9].deleted_at = '2026-11-14T00:00:00Z'
    const s = mountChat(document.getElementById('main'), { source: kaynakKur(satirlar), profile: ben })
    await s.goToMessage(10)
    expect(document.querySelector('.message[data-id="10"]')).toBe(null)
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent).join()).toContain('Mesaj bulunamadı')
    s.destroy()
  })
})
