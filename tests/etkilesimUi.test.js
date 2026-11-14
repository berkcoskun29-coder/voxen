// @vitest-environment jsdom
// Tepki, yanıt ve sabitleme arayüzü (009): mountChat sahte bir "kaynak" nesnesiyle kurulur, ağ yok.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({ profiles: [] }))
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: () => {
      const d = { ids: [] }
      const z = {
        select: () => z,
        in: (_k, ids) => { d.ids = ids; return z },
        then: (res) => Promise.resolve({ data: fake.profiles.filter((p) => d.ids.includes(p.id)), error: null }).then(res),
      }
      return z
    },
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: async () => {},
  },
}))

import { mountChat, yonelmeEki } from '../src/ui/chatView.js'
import { tepkiIpucu } from '../src/ui/reactions.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const ayla = { id: 'u3', username: 'ayla', color: '#e0a030', avatar_url: null }
const ms = (id, author, content = `m${id}`, ek = {}) => ({
  id, channel_id: 'c1', author_id: author, content, edited_at: null, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 14, 10, 0) + id * 60000).toISOString(), ...ek,
})
const bosalt = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }
const mesaj = (id) => document.querySelector(`.message[data-id="${id}"]`)
const tus = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
const etiketler = (id) => [...mesaj(id).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))

// Sahte kaynak: satirlar (id artan) içinden sayfalar; çağrılar kaydedilir
function kaynakKur(satirlar, ek = {}) {
  const k = {
    kind: 'channel', id: 'c1', title: 'genel', placeholder: 'yaz', other: null, canSend: true,
    satirlar,
    fetch: vi.fn(async (before, { limit = 50 } = {}) => {
      let s = k.satirlar.filter((m) => !m.deleted_at && (before == null || m.id < before))
      return s.slice(-limit)
    }),
    send: vi.fn(async (content, opts) => ({ ok: true, message: ms(100, 'u1', content, { reply_to: opts?.replyTo ?? null }) })),
    edit: vi.fn(), remove: vi.fn(async () => {}),
    subscribe: vi.fn((h) => { k.olaylar = h; return () => {} }),
    joinTyping: () => ({ typing() {}, stopped() {}, clear() {}, leave: async () => {} }),
    markRead: () => {},
    canDelete: (m) => m.author_id === 'u1',
    canEdit: (m) => m.author_id === 'u1',
    react: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    fetchPinned: vi.fn(async () => []),
    fetchByIds: vi.fn(async () => []),
    canReact: () => true,
    canPin: () => true,
    ...ek,
  }
  return k
}
async function kur(satirlar, ek = {}, secenek = {}) {
  const kaynak = kaynakKur(satirlar, ek)
  const sohbet = mountChat(document.getElementById('main'), { source: kaynak, profile: ben, ...secenek })
  await bosalt()
  return { kaynak, sohbet }
}

beforeEach(() => {
  fake.profiles = [ben, ali, ayla]
  document.body.innerHTML = '<div id="main"></div>'
})

describe('metin yardımcıları', () => {
  it('tepkiIpucu: en fazla 3 ad, sonra "ve N kişi daha"; bilinmeyen ad sayıya katılır', () => {
    expect(tepkiIpucu(['berk'])).toBe('berk')
    expect(tepkiIpucu(['berk', 'ayla'])).toBe('berk ve ayla')
    expect(tepkiIpucu(['berk', 'ayla', 'can'])).toBe('berk, ayla ve can')
    expect(tepkiIpucu(['berk', 'ayla', 'can', 'ali', 'naz'])).toBe('berk, ayla, can ve 2 kişi daha')
    expect(tepkiIpucu(['berk', 'ayla', null])).toBe('berk, ayla ve 1 kişi daha')
  })
  it('yonelmeEki: ünlü uyumu ve kaynaştırma', () => {
    expect(`berk'${yonelmeEki('berk')}`).toBe("berk'e")
    expect(`ayla'${yonelmeEki('ayla')}`).toBe("ayla'ya")
    expect(`ali'${yonelmeEki('ali')}`).toBe("ali'ye")
    expect(`can'${yonelmeEki('can')}`).toBe("can'a")
    expect(`Oğuz'${yonelmeEki('Oğuz')}`).toBe("Oğuz'a")
  })
})

describe('emoji tepkileri', () => {
  const tepkili = () => [ms(1, 'u2', 'selam', { reactions: [{ emoji: '👍', user_id: 'u2' }, { emoji: '👍', user_id: 'u1' }, { emoji: '🔥', user_id: 'u3' }] })]

  it('gömülü tepkiler rozet olur: "👍 2", kendi tepkim aria-pressed, ipucunda adlar', async () => {
    await kur(tepkili())
    const rozetler = [...mesaj(1).querySelectorAll('.reaction')]
    expect(rozetler.map((b) => b.textContent)).toEqual(['👍2', '🔥1'])
    expect(rozetler[0].getAttribute('aria-pressed')).toBe('true')
    expect(rozetler[1].getAttribute('aria-pressed')).toBe('false')
    expect(rozetler[0].dataset.tip).toBe('ali ve berk')
    expect(rozetler[1].dataset.tip).toBe('ayla')
  })

  it('rozete tıklamak kendi tepkimi kaldırır / ekler', async () => {
    const { kaynak } = await kur(tepkili())
    mesaj(1).querySelector('.reaction[data-emoji="👍"]').click()
    await bosalt()
    expect(kaynak.react).toHaveBeenLastCalledWith(1, '👍', false)
    expect(mesaj(1).querySelector('.reaction[data-emoji="👍"]').textContent).toBe('👍1')
    mesaj(1).querySelector('.reaction[data-emoji="🔥"]').click()
    await bosalt()
    expect(kaynak.react).toHaveBeenLastCalledWith(1, '🔥', true)
    expect(mesaj(1).querySelector('.reaction[data-emoji="🔥"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('😊 seçiciyi açar: 8 emoji, odak ilkinde, oklarla gezilir, Esc kapatır ve odak 😊\'ye döner', async () => {
    await kur([ms(1, 'u2')])
    const dugme = mesaj(1).querySelector('[data-act="tepki"]')
    expect(dugme.getAttribute('aria-label')).toBe('Tepki ekle')
    dugme.click()
    const secici = document.querySelector('.reaction-picker')
    expect(secici.getAttribute('role')).toBe('dialog')
    const secenekler = [...secici.querySelectorAll('.reaction-choice')]
    expect(secenekler.map((b) => b.textContent)).toEqual(['👍', '👎', '😂', '❤️', '😮', '😢', '🔥', '🎉'])
    expect(document.activeElement).toBe(secenekler[0])
    tus(document.activeElement, 'ArrowRight')
    expect(document.activeElement).toBe(secenekler[1])
    tus(document.activeElement, 'ArrowLeft')
    tus(document.activeElement, 'ArrowLeft')
    expect(document.activeElement).toBe(secenekler[7])
    tus(document.activeElement, 'Home')
    expect(document.activeElement).toBe(secenekler[0])
    tus(document.activeElement, 'Escape')
    expect(document.querySelector('.reaction-picker')).toBeNull()
    expect(document.activeElement).toBe(mesaj(1).querySelector('[data-act="tepki"]'))
  })

  it('seçiciden emoji seçmek tepki ekler, rozet çıkar; dışarı tıklamak kapatır', async () => {
    const { kaynak } = await kur([ms(1, 'u2')])
    mesaj(1).querySelector('[data-act="tepki"]').click()
    document.querySelector('.reaction-choice[data-emoji="🎉"]').click()
    await bosalt()
    expect(kaynak.react).toHaveBeenCalledWith(1, '🎉', true)
    expect(mesaj(1).querySelector('.reaction').textContent).toBe('🎉1')
    expect(document.querySelector('.reaction-picker')).toBeNull()
    mesaj(1).querySelector('[data-act="tepki"]').click()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.reaction-picker')).toBeNull()
  })

  it('canlı olay: başkasının tepkisi eklenir/kalkar; başka konuşmanınki yok sayılır; tekrar etkisiz', async () => {
    const { sohbet } = await kur([ms(1, 'u2')])
    sohbet.applyReaction({ channel_id: 'c1', message_id: 1, emoji: '😂', user_id: 'u3', islem: 'INSERT' })
    sohbet.applyReaction({ channel_id: 'c1', message_id: 1, emoji: '😂', user_id: 'u3', islem: 'INSERT' })
    expect(mesaj(1).querySelector('.reaction').textContent).toBe('😂1')
    sohbet.applyReaction({ channel_id: 'baska', message_id: 1, emoji: '😂', user_id: 'u2', islem: 'INSERT' })
    expect(mesaj(1).querySelector('.reaction').textContent).toBe('😂1')
    sohbet.applyReaction({ channel_id: 'c1', message_id: 1, emoji: '😂', user_id: 'u3', islem: 'DELETE' })
    expect(mesaj(1).querySelector('.reaction')).toBeNull()
  })

  it('hata metni toast olur ve rozet değişmez', async () => {
    const hata = Object.assign(new Error('Bunu yapamazsın.'), { code: 'NOT_ALLOWED' })
    await kur([ms(1, 'u2')], { react: vi.fn(async () => { throw hata }) })
    mesaj(1).querySelector('[data-act="tepki"]').click()
    document.querySelector('.reaction-choice').click()
    await bosalt()
    expect(document.querySelector('.toast-hata').textContent).toContain('Bunu yapamazsın.')
    expect(mesaj(1).querySelector('.reaction')).toBeNull()
  })

  it('engelli DM: 😊/↩️/📌 yok, rozetler pasif', async () => {
    await kur([ms(1, 'u2', 'x', { reactions: [{ emoji: '👍', user_id: 'u2' }] })], { kind: 'dm', id: 't1', canSend: false })
    expect(mesaj(1).querySelector('[data-act="tepki"]')).toBeNull()
    expect(mesaj(1).querySelector('[data-act="yanitla"]')).toBeNull()
    expect(mesaj(1).querySelector('.reaction').disabled).toBe(true)
  })
})

describe('yanıtlama', () => {
  it('↩️ şeridi açar ("ali\'ye yanıt veriyorsun"), Enter replyTo ile gönderir, şerit kapanır', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'soru')])
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    const serit = document.querySelector('.reply-bar')
    expect(serit.hidden).toBe(false)
    expect(serit.querySelector('.reply-bar-text').textContent).toBe("ali'ye yanıt veriyorsun")
    const kutu = document.querySelector('textarea')
    expect(document.activeElement).toBe(kutu)
    kutu.value = 'cevap'
    tus(kutu, 'Enter')
    await bosalt()
    expect(kaynak.send).toHaveBeenCalledWith('cevap', { replyTo: 1 })
    expect(serit.hidden).toBe(true)
    // gönderilen mesajda alıntı
    expect(mesaj(100).querySelector('.msg-reply-author').textContent).toBe('ali')
    expect(mesaj(100).querySelector('.msg-reply-text').textContent).toBe('soru')
  })

  it('yanıtsız gönderim send(content) ile (ikinci argüman yok)', async () => {
    const { kaynak } = await kur([])
    const kutu = document.querySelector('textarea')
    kutu.value = 'düz'
    tus(kutu, 'Enter')
    await bosalt()
    expect(kaynak.send.mock.calls[0]).toEqual(['düz'])
  })

  it('Esc ve ✕ yanıtı iptal eder', async () => {
    await kur([ms(1, 'u2')])
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    tus(document.querySelector('textarea'), 'Escape')
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
    mesaj(1).querySelector('[data-act="yanitla"]').click()
    document.querySelector('.reply-bar-cancel').click()
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
  })

  it('alıntı ilk 80 karakter; tıklayınca asıl mesaj vurgulanır', async () => {
    const uzun = 'a'.repeat(100)
    await kur([ms(1, 'u2', uzun), ms(2, 'u1', 'yanıt', { reply_to: 1 })])
    expect(mesaj(2).querySelector('.msg-reply-text').textContent).toBe('a'.repeat(80) + '…')
    expect(mesaj(2).classList.contains('grouped')).toBe(false)
    mesaj(2).querySelector('.msg-reply').click()
    await bosalt()
    expect(mesaj(1).classList.contains('flash')).toBe(true)
  })

  it('listede olmayan hedef fetchByIds ile gelir; silinmişse "Mesaj silindi" (tıklanmaz)', async () => {
    const { kaynak } = await kur([ms(5, 'u1', 'y1', { reply_to: 2 }), ms(6, 'u1', 'y2', { reply_to: 3 })], {
      fetchByIds: vi.fn(async () => [ms(2, 'u3', 'eski mesaj'), ms(3, 'u2', '', { deleted_at: '2026-11-14T10:00:00Z' })]),
    })
    expect(kaynak.fetchByIds).toHaveBeenCalledWith([2, 3])
    expect(mesaj(5).querySelector('.msg-reply-author').textContent).toBe('ayla')
    expect(mesaj(5).querySelector('.msg-reply-text').textContent).toBe('eski mesaj')
    const gitti = mesaj(6).querySelector('.msg-reply')
    expect(gitti.textContent).toBe('Mesaj silindi')
    expect(gitti.tagName).not.toBe('BUTTON')
  })

  it('asıl mesaj canlı silinince alıntı "Mesaj silindi" olur; yazarken silinirse şerit kapanır', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'x'), ms(2, 'u1', 'y', { reply_to: 1 }), ms(3, 'u2', 'z')])
    mesaj(3).querySelector('[data-act="yanitla"]').click()
    kaynak.olaylar.onUpdate({ ...ms(1, 'u2', ''), deleted_at: '2026-11-14T11:00:00Z' })
    expect(mesaj(2).querySelector('.msg-reply').textContent).toBe('Mesaj silindi')
    kaynak.olaylar.onUpdate({ ...ms(3, 'u2', ''), deleted_at: '2026-11-14T11:00:00Z' })
    expect(document.querySelector('.reply-bar').hidden).toBe(true)
    expect(document.querySelector('.toast').textContent).toContain('Yanıtladığın mesaj silindi.')
  })

  it('hedef yüklü değilse eski mesajlar yüklenir ve gidilir; hiç yoksa "Mesaj bulunamadı"', async () => {
    const satirlar = []
    for (let i = 1; i <= 60; i++) satirlar.push(ms(i, 'u2', `m${i}`))
    satirlar.push(ms(61, 'u1', 'yanıt', { reply_to: 3 }), ms(62, 'u1', 'yanıt2', { reply_to: 999 }))
    // 999 hiç yok: alıntı için fetchByIds onu da "eski" gibi döndürsün (yüklü değil)
    const { kaynak } = await kur(satirlar, { fetchByIds: vi.fn(async (ids) => satirlar.filter((m) => ids.includes(m.id))) })
    expect(mesaj(3)).toBeNull()
    mesaj(61).querySelector('.msg-reply').click()
    await bosalt()
    expect(kaynak.fetch.mock.calls.some(([before]) => before != null)).toBe(true)
    expect(mesaj(3).classList.contains('flash')).toBe(true)
  })
})

describe('sabitleme', () => {
  it('📌 Sabitle -> pin(id, true), işaret çıkar, etiket "Sabitlemeyi kaldır"; tekrar -> kaldırır', async () => {
    const { kaynak } = await kur([ms(1, 'u2')])
    expect(etiketler(1)).toEqual(['Tepki ekle', 'Yanıtla', 'Sabitle'])
    mesaj(1).querySelector('[data-act="sabitle"]').click()
    await bosalt()
    expect(kaynak.pin).toHaveBeenLastCalledWith(1, true)
    expect(mesaj(1).querySelector('.msg-pin').getAttribute('aria-label')).toBe('Sabitlendi')
    expect(mesaj(1).querySelector('[data-act="sabitle"]').getAttribute('aria-label')).toBe('Sabitlemeyi kaldır')
    mesaj(1).querySelector('[data-act="sabitle"]').click()
    await bosalt()
    expect(kaynak.pin).toHaveBeenLastCalledWith(1, false)
    expect(mesaj(1).querySelector('.msg-pin')).toBeNull()
  })

  it('yetkisiz (canPin false) 📌 görmez; gömülü sabit işaret olarak görünür; canlı sabit olayı işlenir', async () => {
    const { sohbet } = await kur([ms(1, 'u2', 'a', { pin: { pinned_at: 'x', pinned_by: 'u2' } }), ms(2, 'u3', 'b')], { canPin: () => false })
    expect(mesaj(1).querySelector('[data-act="sabitle"]')).toBeNull()
    expect(mesaj(1).querySelector('.msg-pin')).not.toBeNull()
    sohbet.applyPin({ channel_id: 'c1', message_id: 2, islem: 'INSERT' })
    expect(mesaj(2).querySelector('.msg-pin')).not.toBeNull()
    sohbet.applyPin({ channel_id: 'c1', message_id: 1, islem: 'DELETE' })
    expect(mesaj(1).querySelector('.msg-pin')).toBeNull()
  })

  it('PIN_LIMIT metni toast olur', async () => {
    await kur([ms(1, 'u2')], { pin: vi.fn(async () => { throw new Error('En fazla 50 mesaj sabitlenebilir.') }) })
    mesaj(1).querySelector('[data-act="sabitle"]').click()
    await bosalt()
    expect(document.querySelector('.toast-hata').textContent).toContain('En fazla 50 mesaj sabitlenebilir.')
    expect(mesaj(1).querySelector('.msg-pin')).toBeNull()
  })

  it('başlıktaki 📌 listeyi açar: yazar, kısa metin; satıra tıklayınca mesaja gidilir', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'önemli'), ms(2, 'u1')], {
      fetchPinned: vi.fn(async () => [{ ...ms(1, 'u2', 'önemli'), pinned_at: 'x', pinned_by: 'u1' }]),
    })
    const dugme = document.querySelector('.main-header .pins-toggle')
    expect(dugme.getAttribute('aria-label')).toBe('Sabitlenmiş mesajlar')
    dugme.click()
    await bosalt()
    expect(kaynak.fetchPinned).toHaveBeenCalled()
    const pencere = document.querySelector('.modal-card')
    expect(pencere.querySelector('.modal-title').textContent).toBe('Sabitlenmiş mesajlar')
    const satir = pencere.querySelector('.pin-item')
    expect(satir.querySelector('strong').textContent).toBe('ali')
    expect(satir.querySelector('.pin-item-text').textContent).toBe('önemli')
    satir.querySelector('.pin-item-go').click()
    await bosalt()
    expect(document.querySelector('.modal-card')).toBeNull()
    expect(mesaj(1).classList.contains('flash')).toBe(true)
  })

  it('listede yetkiliye "Sabitlemeyi kaldır"; basınca pin(id, false) ve satır kalkar; boşsa açıklama', async () => {
    const { kaynak } = await kur([ms(1, 'u2', 'önemli', { pin: { pinned_at: 'x' } })], {
      fetchPinned: vi.fn(async () => [{ ...ms(1, 'u2', 'önemli'), pinned_at: 'x', pinned_by: 'u1' }]),
    })
    document.querySelector('.pins-toggle').click()
    await bosalt()
    document.querySelector('.pin-item-unpin').click()
    await bosalt()
    expect(kaynak.pin).toHaveBeenLastCalledWith(1, false)
    expect(document.querySelector('.pin-item')).toBeNull()
    expect(document.querySelector('.pin-list-status').textContent).toBe('Henüz sabitlenmiş mesaj yok.')
    expect(mesaj(1).querySelector('.msg-pin')).toBeNull()
  })

  it('mesaj eski sayfalarda da bulunamazsa "Mesaj bulunamadı"', async () => {
    await kur([ms(10, 'u2')], { fetchPinned: vi.fn(async () => [{ ...ms(4, 'u2', 'kayıp'), pinned_at: 'x' }]) })
    document.querySelector('.pins-toggle').click()
    await bosalt()
    document.querySelector('.pin-item-go').click()
    await bosalt()
    expect(document.querySelector('.toast').textContent).toContain('Mesaj bulunamadı')
  })

  it('yetkisiz listede "Sabitlemeyi kaldır" görmez', async () => {
    await kur([ms(1, 'u2')], { canPin: () => false, fetchPinned: vi.fn(async () => [{ ...ms(1, 'u2'), pinned_at: 'x' }]) })
    document.querySelector('.pins-toggle').click()
    await bosalt()
    expect(document.querySelector('.pin-item')).not.toBeNull()
    expect(document.querySelector('.pin-item-unpin')).toBeNull()
  })

  it("DM 'pin' satırı sistem satırı: ortalı, eylem yok, gruplamaz", async () => {
    await kur([ms(1, 'u1', 'selam'), ms(2, 'u1', 'berk bir mesajı sabitledi.', { kind: 'pin' }), ms(3, 'u1', 'devam')], { kind: 'dm', id: 't1' })
    expect(mesaj(2).classList.contains('pin-log')).toBe(true)
    expect(mesaj(2).textContent).toBe('berk bir mesajı sabitledi.')
    expect(mesaj(2).querySelector('[data-act]')).toBeNull()
    expect(mesaj(3).classList.contains('grouped')).toBe(false)
  })
})
