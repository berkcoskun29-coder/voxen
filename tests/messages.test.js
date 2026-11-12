// @vitest-environment jsdom
// Mesaj testleri: Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => ({}))

vi.mock('../src/lib/supabase.js', () => {
  fake.msgRows = [] // 'messages' tablosundaki tüm satırlar (id artan)
  fake.profiles = []
  fake.calls = [] // fetch çağrıları: { before, limit }
  fake.insertResult = null
  fake.handlers = [] // realtime geri çağrıları
  fake.removed = 0
  fake.msgGate = null
  fake.inserted = null
  fake.topics = []
  fake.subCbs = [] // subscribe(durum) geri çağrıları (yeniden bağlanmayı taklit için)
  fake.from = vi.fn((tablo) => {
    const durum = { before: null, after: null, asc: false, limit: 1000, ids: null }
    const zincir = {
      select: () => zincir,
      eq: () => zincir,
      lt: (_k, v) => { durum.before = v; return zincir },
      gt: (_k, v) => { durum.after = v; return zincir },
      in: (_k, ids) => { durum.ids = ids; return zincir },
      order: (_k, o) => { durum.asc = !!o?.ascending; return zincir },
      limit: (n) => { durum.limit = n; return zincir },
      insert: (v) => { fake.inserted = v; return zincir },
      single: async () => fake.insertResult(),
      then: async (res) => {
        if (tablo === 'messages' && fake.msgGate) await fake.msgGate
        if (tablo === 'profiles') {
          return res({ data: fake.profiles.filter((p) => durum.ids.includes(p.id)), error: null })
        }
        fake.calls.push({ before: durum.before, limit: durum.limit, ...(durum.after != null && { after: durum.after }) })
        let satirlar = fake.msgRows.filter((m) => (durum.before == null || m.id < durum.before) &&
          (durum.after == null || m.id > durum.after))
        if (!durum.asc) satirlar = satirlar.slice().reverse() // yeniden eskiye
        satirlar = satirlar.slice(0, durum.limit)
        return res({ data: satirlar, error: null })
      },
    }
    return zincir
  })
  fake.channel = vi.fn((konu) => {
    fake.topics.push(konu)
    const k = {
      on: (_t, _f, cb) => { fake.handlers.push(cb); return k },
      subscribe: (cb) => { fake.subCbs.push(cb); return k },
    }
    return k
  })
  fake.removeChannel = vi.fn(() => { fake.removed++ })
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (...a) => fake.removeChannel(...a),
    },
  }
})

import { sendMessage, fetchMessages, subscribeMessages } from '../src/data/messages.js'
import { renderMessage, mountChat } from '../src/ui/chatView.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e0a030', avatar_url: null }
const ms = (id, author, dakika, content = 'x') => ({
  id,
  channel_id: 'c1',
  author_id: author,
  content,
  // sabit bir günde, dakika kadar sonra
  created_at: new Date(Date.UTC(2026, 10, 12, 10, 0) + dakika * 60000).toISOString(),
})
const bekle = () => new Promise((r) => setTimeout(r, 0))
const bosalt = async () => { for (let i = 0; i < 5; i++) await bekle() }

beforeEach(() => {
  fake.msgRows = []
  fake.profiles = [ben, ali]
  fake.calls = []
  fake.handlers = []
  fake.removed = 0
  fake.msgGate = null
  fake.insertResult = async () => ({ data: ms(999, 'u1', 0, 'selam'), error: null })
  document.body.innerHTML = '<div id="main"></div>'
})

describe('renderMessage', () => {
  it('<img onerror> içeriğini metin olarak basar', () => {
    const el = renderMessage({ ...ms(1, 'u1', 0), content: '<img src=x onerror=alert(1)>' }, ben)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })
  it('yazar adı profil renginde, saat 2 haneli', () => {
    const el = renderMessage(ms(1, 'u1', 5), ben)
    expect(el.querySelector('.msg-author').style.color).not.toBe('')
    expect(el.querySelector('.msg-time').textContent).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('sendMessage', () => {
  it('2001 karakter gönderilmez ve uyarı döner', async () => {
    const r = await sendMessage('c1', 'a'.repeat(2001), 'u1')
    expect(r).toEqual({ ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' })
    expect(fake.from).not.toHaveBeenCalled()
  })
  it('geçerli mesajı kırpılmış içerik, author_id ve channel_id ile ekler', async () => {
    const r = await sendMessage('c1', '  merhaba  ', 'u1')
    expect(r.ok).toBe(true)
    expect(fake.inserted).toEqual({ channel_id: 'c1', author_id: 'u1', content: 'merhaba' })
  })
  it('aynı kanala iki kez abone olunca konular farklı olur', () => {
    subscribeMessages('c1', () => {})
    subscribeMessages('c1', () => {})
    expect(fake.topics[0]).not.toBe(fake.topics[1])
  })
  it('boş (boşluk) mesaj gönderilmez', async () => {
    expect((await sendMessage('c1', '   ', 'u1')).ok).toBe(false)
    expect(fake.from).not.toHaveBeenCalled()
  })
})

describe('mountChat', () => {
  it('aynı yazarın 5 dk içindeki ardışık mesajları başlıksız gruplanır', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 3), ms(3, 'u1', 10), ms(4, 'u2', 11)]
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const satirlar = [...document.querySelectorAll('.message')]
    expect(satirlar.map((s) => s.classList.contains('grouped'))).toEqual([false, true, false, false])
  })

  it('gün değişince tarih çizgisi çıkar', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 60 * 24)]
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const ayraclar = [...document.querySelectorAll('.day-separator')].map((a) => a.textContent)
    expect(ayraclar).toEqual(['12 Kasım 2026', '13 Kasım 2026'])
  })

  it('yukarı kaydırınca before=ilkMesajId ile 50 eski mesaj yüklenir, 50den azsa durur', async () => {
    fake.msgRows = Array.from({ length: 120 }, (_, i) => ms(i + 1, 'u1', i))
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    expect(document.querySelectorAll('.message')).toHaveLength(50) // 71..120
    const liste = document.querySelector('.message-list')
    liste.scrollTop = 0
    liste.dispatchEvent(new Event('scroll'))
    await bosalt()
    expect(fake.calls.at(-1)).toEqual({ before: 71, limit: 50 })
    expect(document.querySelectorAll('.message')).toHaveLength(100)
    liste.dispatchEvent(new Event('scroll'))
    await bosalt()
    expect(fake.calls.at(-1)).toEqual({ before: 21, limit: 50 }) // 20 geldi -> artık durur
    expect(document.querySelectorAll('.message')).toHaveLength(120)
    const sayi = fake.calls.length
    liste.dispatchEvent(new Event('scroll'))
    await bosalt()
    expect(fake.calls).toHaveLength(sayi)
  })

  it('Enter gönderir; başarılıysa kutu temizlenir, realtime tekrarı çift yazmaz', async () => {
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const kutu = document.querySelector('textarea')
    expect(kutu.placeholder).toBe('#genel kanalına mesaj yaz…')
    kutu.value = ' selam '
    kutu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await bosalt()
    expect(kutu.value).toBe('')
    fake.handlers[0]({ new: ms(999, 'u1', 0, 'selam') }) // aynı mesaj realtime ile de gelir
    await bosalt()
    expect(document.querySelectorAll('.message')).toHaveLength(1)
  })

  it('Shift+Enter göndermez; başarısız gönderimde kutu korunur', async () => {
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const kutu = document.querySelector('textarea')
    kutu.value = 'merhaba'
    kutu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
    await bosalt()
    expect(document.querySelectorAll('.message')).toHaveLength(0)
    fake.insertResult = async () => ({ data: null, error: { message: 'x' } })
    kutu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await bosalt()
    expect(kutu.value).toBe('merhaba')
    expect(document.querySelector('.toast').textContent).toBe('Mesaj gönderilemedi')
  })

  it('2000den uzun metinde uyarı gösterilir, sayaç yalnız 1800den sonra', async () => {
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const kutu = document.querySelector('textarea')
    const uyari = document.querySelector('.composer-warning')
    kutu.value = 'a'.repeat(1800)
    kutu.dispatchEvent(new Event('input'))
    expect(uyari.textContent).toBe('')
    kutu.value = 'a'.repeat(1900)
    kutu.dispatchEvent(new Event('input'))
    expect(uyari.textContent).toBe('1900 / 2000')
    kutu.value = 'a'.repeat(2001)
    kutu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await bosalt()
    expect(uyari.textContent).toBe('Mesaj en fazla 2000 karakter olabilir')
    expect(kutu.value).toHaveLength(2001)
  })

  it('realtime mesajı ilk yüklemeden önce gelse de liste id sırasında kalır', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 1)]
    let ac
    fake.msgGate = new Promise((r) => { ac = r })
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    fake.handlers[0]({ new: ms(3, 'u2', 2, 'yeni') }) // fetch bitmeden geldi
    await bosalt()
    ac()
    await bosalt()
    expect([...document.querySelectorAll('.message')].map((e) => e.dataset.id)).toEqual(['1', '2', '3'])
  })

  it('alta yapışıkken liste boyu değişince (görüntü bölmesi açıldı) en altta kalır; yukarıdaysa kalmaz', async () => {
    const gozlemciler = []
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.izlenen = []; this.kesildi = false; gozlemciler.push(this) }
      observe(e) { this.izlenen.push(e) }
      disconnect() { this.kesildi = true }
    }
    try {
      const chat = mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
      await bosalt()
      const liste = document.querySelector('.message-list')
      const ro = gozlemciler.find((g) => g.izlenen.includes(liste))
      expect(ro).toBeTruthy()
      // Ölçüler: içerik 1000, görünen 300
      Object.defineProperty(liste, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(liste, 'clientHeight', { configurable: true, value: 300 })
      liste.scrollTop = 700 // en altta
      liste.dispatchEvent(new Event('scroll'))
      // Bölme açıldı: liste kısaldı -> alttan kaydı; gözlemci yeniden en alta indirir
      Object.defineProperty(liste, 'clientHeight', { configurable: true, value: 150 })
      ro.cb([])
      expect(liste.scrollTop).toBe(1000)
      // Kullanıcı yukarı kaydırdı: artık yapışık değil
      liste.scrollTop = 200
      liste.dispatchEvent(new Event('scroll'))
      ro.cb([])
      expect(liste.scrollTop).toBe(200)
      chat.destroy()
      expect(ro.kesildi).toBe(true)
    } finally {
      delete globalThis.ResizeObserver
    }
  })

  it('destroy aboneliği kapatır ve sonraki realtime mesajı yok sayılır', async () => {
    const chat = mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    chat.destroy()
    expect(fake.removed).toBe(1)
    fake.handlers[0]({ new: ms(5, 'u1', 0) })
    await bosalt()
    expect(document.querySelectorAll('.message')).toHaveLength(0)
  })

  it('fetchMessages eskiden yeniye döner', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 1)]
    expect((await fetchMessages('c1')).map((m) => m.id)).toEqual([1, 2])
  })
})

describe('yeniden bağlanınca geri doldurma', () => {
  it('ilk SUBSCRIBED bir şey getirmez; sonraki SUBSCRIBED son idden yenileri getirir', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 1), ms(3, 'u2', 2), ms(4, 'u2', 3)]
    const gelen = []
    subscribeMessages('c1', (m) => gelen.push(m.id), { getLastId: () => 2 })
    const durumBildir = fake.subCbs.at(-1)
    durumBildir('SUBSCRIBED')
    await bosalt()
    expect(fake.calls).toEqual([])
    durumBildir('CHANNEL_ERROR') // bağlantı koptu
    durumBildir('SUBSCRIBED') // yeniden bağlandı
    await bosalt()
    expect(fake.calls.at(-1)).toMatchObject({ after: 2 })
    expect(gelen).toEqual([3, 4]) // eskiden yeniye
  })

  it('mountChat: kopukken gelen mesajlar yeniden bağlanınca listeye eklenir, tekrar yok', async () => {
    fake.msgRows = [ms(1, 'u1', 0), ms(2, 'u1', 1)]
    mountChat(document.getElementById('main'), { channel: { id: 'c1', name: 'genel' }, profile: ben })
    await bosalt()
    const durumBildir = fake.subCbs.at(-1)
    durumBildir('SUBSCRIBED')
    fake.msgRows.push(ms(3, 'u2', 2, 'kopukken'), ms(4, 'u2', 3, 'bu da'))
    durumBildir('SUBSCRIBED')
    await bosalt()
    const icerik = [...document.querySelectorAll('.msg-text')].map((e) => e.textContent)
    expect(icerik).toEqual(['x', 'x', 'kopukken', 'bu da'])
  })
})
