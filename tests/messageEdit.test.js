// @vitest-environment jsdom
// Mesaj düzenleme/silme arayüzü testleri: Supabase sahte nesneyle değiştirilir, ağ kullanılmaz.
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
    const durum = { before: null, after: null, asc: false, limit: 1000, ids: null, bos: [] }
    const zincir = {
      select: () => zincir,
      eq: () => zincir,
      lt: (_k, v) => { durum.before = v; return zincir },
      gt: (_k, v) => { durum.after = v; return zincir },
      in: (_k, ids) => { durum.ids = ids; return zincir },
      is: (k, v) => { if (v === null) durum.bos.push(k); return zincir },
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
        fake.isNull = durum.bos
        let satirlar = fake.msgRows.filter((m) => (durum.before == null || m.id < durum.before) &&
          (durum.after == null || m.id > durum.after) && durum.bos.every((k) => m[k] == null))
        if (!durum.asc) satirlar = satirlar.slice().reverse() // yeniden eskiye
        satirlar = satirlar.slice(0, durum.limit)
        return res({ data: satirlar, error: null })
      },
    }
    return zincir
  })
  fake.rpc = vi.fn(async () => ({ data: null, error: null }))
  fake.ons = [] // { event, filter } her .on() çağrısı
  fake.channel = vi.fn((konu) => {
    fake.topics.push(konu)
    const k = {
      on: (_t, f, cb) => { fake.handlers.push(cb); fake.ons.push({ ...f, cb }); return k },
      subscribe: (cb) => { fake.subCbs.push(cb); return k },
    }
    return k
  })
  fake.removeChannel = vi.fn(() => { fake.removed++ })
  return {
    supabase: {
      from: (...a) => fake.from(...a),
      rpc: (...a) => fake.rpc(...a),
      channel: (...a) => fake.channel(...a),
      removeChannel: (...a) => fake.removeChannel(...a),
    },
  }
})


import { mountChat } from '../src/ui/chatView.js'

const ben = { id: 'u1', username: 'berk', color: '#5b7cfa', avatar_url: null }
const ali = { id: 'u2', username: 'ali', color: '#e0a030', avatar_url: null }
const ms = (id, author, content = 'x') => ({
  id, channel_id: 'c1', author_id: author, content, edited_at: null, deleted_at: null,
  created_at: new Date(Date.UTC(2026, 10, 12, 10, 0) + id * 60000).toISOString(),
})
const bekle = () => new Promise((r) => setTimeout(r, 0))
const bosalt = async () => { for (let i = 0; i < 5; i++) await bekle() }
const ana = () => document.getElementById('main')
const olay = (ad) => fake.ons.find((o) => o.event === ad).cb
const metinler = () => [...document.querySelectorAll('.msg-text')].map((e) => e.textContent)
const kur = async (satirlar, secenek = {}) => {
  fake.msgRows = satirlar
  const sohbet = mountChat(ana(), { channel: { id: 'c1', name: 'genel' }, profile: ben, ...secenek })
  await bosalt()
  return sohbet
}
const tus = (el, key, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
const mesaj = (id) => document.querySelector(`.message[data-id="${id}"]`)

beforeEach(() => {
  fake.msgRows = []
  fake.profiles = [ben, ali]
  fake.calls = []
  fake.handlers = []
  fake.ons = []
  fake.subCbs = []
  fake.msgGate = null
  fake.rpc.mockReset()
  fake.rpc.mockImplementation(async () => ({ data: null, error: null }))
  document.body.innerHTML = '<div id="main"></div>'
})

describe('simgeler', () => {
  it('kendi mesajında ✏️ ve 🗑️, başkasınınkinde yalnız 😊 ve ↩️ (sahip değilse 📌 yok)', async () => {
    await kur([ms(1, 'u1'), ms(2, 'u2')])
    expect([...mesaj(1).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))).toEqual(['Tepki ekle', 'Yanıtla', 'Düzenle', 'Sil'])
    expect([...mesaj(2).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))).toEqual(['Tepki ekle', 'Yanıtla'])
  })
  it('sunucu sahibi başkasının mesajında ✏️ görmez; 📌 ve 🗑️ görür', async () => {
    await kur([ms(1, 'u1'), ms(2, 'u2')], { isOwner: true })
    expect([...mesaj(2).querySelectorAll('.msg-action')].map((b) => b.getAttribute('aria-label'))).toEqual(['Tepki ekle', 'Yanıtla', 'Sabitle', 'Sil'])
    expect(mesaj(1).querySelectorAll('.msg-action')).toHaveLength(5)
  })
})

describe('düzenleme', () => {
  it('✏️ mesajı kutuya çevirir; alt yazı görünür; Enter kaydeder ve (düzenlendi) çıkar', async () => {
    await kur([ms(1, 'u1', 'eski')])
    fake.rpc.mockImplementation(async () => ({ data: { ...ms(1, 'u1', 'yeni'), edited_at: '2026-11-12T11:00:00Z' }, error: null }))
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = mesaj(1).querySelector('.msg-edit-input')
    expect(kutu.value).toBe('eski')
    expect(document.activeElement).toBe(kutu)
    expect(mesaj(1).querySelector('.msg-edit-hint').textContent).toBe('Esc ile vazgeç · Enter ile kaydet')
    kutu.value = '  yeni  '
    tus(kutu, 'Enter')
    await bosalt()
    expect(fake.rpc).toHaveBeenCalledWith('edit_message', { id: 1, yeni: 'yeni' })
    expect(mesaj(1).querySelector('.msg-edit-input')).toBeNull()
    expect(mesaj(1).querySelector('.msg-text').textContent).toContain('yeni')
    const etiket = mesaj(1).querySelector('.msg-edited')
    expect(etiket.textContent.trim()).toBe('(düzenlendi)')
    expect(etiket.dataset.tip).toMatch(/^Düzenlendi: 12 Kasım 2026/)
  })
  it('(düzenlendi) saatin yanında durur (metnin sonunda değil)', async () => {
    await kur([{ ...ms(1, 'u1', 'merhaba'), edited_at: new Date(Date.UTC(2026, 10, 12, 11, 0)).toISOString() }])
    const baslik = mesaj(1).querySelector('.msg-head')
    expect(baslik.querySelector('.msg-time').nextElementSibling.className).toBe('msg-edited')
    expect(mesaj(1).querySelector('.msg-text .msg-edited')).toBeNull()
    expect(mesaj(1).querySelector('.msg-edited').dataset.tip).toMatch(/^Düzenlendi: /)
  })
  it('Shift+Enter kaydetmez, Esc vazgeçer ve istek atmaz', async () => {
    await kur([ms(1, 'u1', 'eski')])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = mesaj(1).querySelector('.msg-edit-input')
    kutu.value = 'değişti'
    tus(kutu, 'Enter', { shiftKey: true })
    await bosalt()
    expect(fake.rpc).not.toHaveBeenCalled()
    tus(kutu, 'Escape')
    expect(mesaj(1).querySelector('.msg-edit-input')).toBeNull()
    expect(metinler()).toEqual(['eski'])
  })
  it('değişmeyen metinde istek atılmaz; boş metinde uyarı çıkar', async () => {
    await kur([ms(1, 'u1', 'eski')])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = mesaj(1).querySelector('.msg-edit-input')
    kutu.value = '   '
    tus(kutu, 'Enter')
    await bosalt()
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(mesaj(1).querySelector('.msg-edit-warning').textContent).not.toBe('')
    kutu.value = 'eski'
    tus(kutu, 'Enter')
    await bosalt()
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(mesaj(1).querySelector('.msg-edit-input')).toBeNull()
  })
  it('kayıt hatasında kutu ve yazılan korunur', async () => {
    await kur([ms(1, 'u1', 'eski')])
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'x' } }))
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = mesaj(1).querySelector('.msg-edit-input')
    kutu.value = 'yeni'
    tus(kutu, 'Enter')
    await bosalt()
    expect(mesaj(1).querySelector('.msg-edit-input').value).toBe('yeni')
    expect(document.querySelector('.toast').textContent).toBe('Mesaj düzenlenemedi. Tekrar dene.')
  })
  it('kutu boşken ↑ son kendi mesajını açar; doluyken açmaz', async () => {
    await kur([ms(1, 'u1', 'ilk'), ms(2, 'u1', 'son'), ms(3, 'u2', 'ali')])
    const yazi = document.querySelector('.composer textarea')
    yazi.value = 'yazıyorum'
    tus(yazi, 'ArrowUp')
    expect(document.querySelector('.msg-edit-input')).toBeNull()
    yazi.value = ''
    tus(yazi, 'ArrowUp')
    expect(mesaj(2).querySelector('.msg-edit-input').value).toBe('son')
    expect(mesaj(1).querySelector('.msg-edit-input')).toBeNull()
  })
  it('kullanıcı yazısı HTML olarak çalışmaz', async () => {
    await kur([ms(1, 'u1', '<img src=x onerror=alert(1)>')])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    expect(document.querySelector('.msg-edit-input').value).toBe('<img src=x onerror=alert(1)>')
    expect(document.querySelector('.message img')).toBeNull()
  })
})

describe('silme', () => {
  it('🗑️ onay penceresi açar (önizleme ile); Sil mesajı kaldırır', async () => {
    await kur([ms(1, 'u1', 'merhaba dünya'), ms(2, 'u2')])
    mesaj(1).querySelector('[data-act="sil"]').click()
    expect(document.querySelector('.modal-title').textContent).toBe('Mesaj silinsin mi?')
    expect(document.querySelector('.msg-delete-preview').textContent).toContain('merhaba dünya')
    expect(fake.rpc).not.toHaveBeenCalled()
    document.querySelector('.modal-foot button.danger').click()
    await bosalt()
    expect(fake.rpc).toHaveBeenCalledWith('delete_message', { id: 1 })
    expect(mesaj(1)).toBeNull()
    expect(document.querySelector('.modal-back')).toBeNull()
  })
  it('Vazgeç silmez', async () => {
    await kur([ms(1, 'u1')])
    mesaj(1).querySelector('[data-act="sil"]').click()
    document.querySelector('.modal-foot button.secondary').click()
    await bosalt()
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(mesaj(1)).not.toBeNull()
  })
  it('Shift+tık onaysız siler', async () => {
    await kur([ms(1, 'u1')])
    mesaj(1).querySelector('[data-act="sil"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await bosalt()
    expect(document.querySelector('.modal-back')).toBeNull()
    expect(fake.rpc).toHaveBeenCalledWith('delete_message', { id: 1 })
    expect(mesaj(1)).toBeNull()
  })
  it('çift Shift+tık tek silme isteği atar', async () => {
    await kur([ms(1, 'u1')])
    let bitir
    fake.rpc.mockImplementation(() => new Promise((r) => { bitir = () => r({ data: null, error: null }) }))
    const sil = mesaj(1).querySelector('[data-act="sil"]')
    sil.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    sil.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await bosalt()
    expect(fake.rpc.mock.calls.filter((c) => c[0] === 'delete_message')).toHaveLength(1)
    bitir()
    await bosalt()
    expect(mesaj(1)).toBeNull()
  })
  it('onay penceresi silip kapanınca odak yazı kutusuna döner', async () => {
    await kur([ms(1, 'u1'), ms(2, 'u2')])
    const sil = mesaj(1).querySelector('[data-act="sil"]')
    sil.focus()
    sil.click()
    document.querySelector('.modal-foot button.danger').click()
    await bosalt()
    expect(document.activeElement).toBe(document.querySelector('.composer textarea'))
  })
  it('Vazgeç deyince odak 🗑️ düğmesine döner', async () => {
    await kur([ms(1, 'u1')])
    const sil = mesaj(1).querySelector('[data-act="sil"]')
    sil.focus()
    sil.click()
    document.querySelector('.modal-foot button.secondary').click()
    expect(document.activeElement).toBe(sil)
  })
  it('silme hatasında pencere açık kalır ve mesaj yerinde durur', async () => {
    await kur([ms(1, 'u1')])
    fake.rpc.mockImplementation(async () => ({ data: null, error: { message: 'x' } }))
    mesaj(1).querySelector('[data-act="sil"]').click()
    document.querySelector('.modal-foot button.danger').click()
    await bosalt()
    expect(document.querySelector('.modal-body .error').textContent).toBe('Mesaj silinemedi. Tekrar dene.')
    expect(mesaj(1)).not.toBeNull()
  })
})

describe('canlı güncelleme', () => {
  it('UPDATE ile düzenlenen mesaj yerinde değişir, silinen kalkar', async () => {
    await kur([ms(1, 'u2', 'bir'), ms(2, 'u2', 'iki')])
    olay('UPDATE')({ new: { ...ms(1, 'u2', 'bir-düzenli'), edited_at: '2026-11-12T11:00:00Z' } })
    await bosalt()
    expect(mesaj(1).querySelector('.msg-text').textContent).toContain('bir-düzenli')
    expect(mesaj(1).querySelector('.msg-edited')).not.toBeNull()
    olay('UPDATE')({ new: { ...ms(2, 'u2', ''), deleted_at: '2026-11-12T11:00:00Z' } })
    await bosalt()
    expect(mesaj(2)).toBeNull()
    // silinen mesajın gecikmiş INSERT'i geri getirmez
    olay('INSERT')({ new: ms(2, 'u2', 'iki') })
    await bosalt()
    expect(mesaj(2)).toBeNull()
  })
  it('açık düzenleme kutusu yeni mesaj ve canlı UPDATE gelince bozulmaz', async () => {
    await kur([ms(1, 'u1', 'benim'), ms(2, 'u2', 'ali')])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = document.querySelector('.msg-edit-input')
    kutu.value = 'yarım kalan yazı'
    kutu.setSelectionRange(3, 6)
    olay('INSERT')({ new: ms(3, 'u2', 'yeni mesaj') })
    await bosalt()
    olay('UPDATE')({ new: { ...ms(2, 'u2', 'ali-düzenli'), edited_at: '2026-11-12T11:00:00Z' } })
    await bosalt()
    expect(document.querySelector('.msg-edit-input')).toBe(kutu) // aynı öğe
    expect(kutu.isConnected).toBe(true)
    expect(kutu.value).toBe('yarım kalan yazı')
    expect(document.activeElement).toBe(kutu)
    expect([kutu.selectionStart, kutu.selectionEnd]).toEqual([3, 6])
    expect(metinler()).toContain('yeni mesaj')
    expect(metinler().some((t) => t.startsWith('ali-düzenli'))).toBe(true)
    // kendi mesajımız başka yerden düzenlenirse yazılan yine korunur
    olay('UPDATE')({ new: { ...ms(1, 'u1', 'başka cihaz'), edited_at: '2026-11-12T11:05:00Z' } })
    await bosalt()
    expect(document.querySelector('.msg-edit-input').value).toBe('yarım kalan yazı')
  })
  it('düzenlenen mesaj silinirse kutu kapanır ve bilgi verilir', async () => {
    await kur([ms(1, 'u1', 'benim')])
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    olay('UPDATE')({ new: { ...ms(1, 'u1', ''), deleted_at: '2026-11-12T11:00:00Z' } })
    await bosalt()
    expect(document.querySelector('.msg-edit-input')).toBeNull()
    expect(mesaj(1)).toBeNull()
    expect(document.querySelector('.toast').textContent).toBe('Düzenlediğin mesaj silindi.')
  })
})

describe('yeniden bağlanınca uzlaştırma', () => {
  it('kopukken düzenlenen güncellenir, silinen kalkar; ilk bağlanışta ek sorgu yok', async () => {
    await kur([ms(1, 'u2', 'bir'), ms(2, 'u2', 'iki'), ms(3, 'u2', 'üç')])
    fake.subCbs[0]('SUBSCRIBED') // ilk bağlanış: ilk yükleme zaten getirdi
    await bosalt()
    expect(fake.calls).toHaveLength(1)
    // bağlantı kopukken: 2 düzenlendi, 3 silindi
    fake.msgRows[1] = { ...fake.msgRows[1], content: 'iki-düzenli', edited_at: '2026-11-12T11:00:00Z' }
    fake.msgRows[2] = { ...fake.msgRows[2], content: '', deleted_at: '2026-11-12T11:00:00Z' }
    fake.subCbs[0]('SUBSCRIBED') // yeniden bağlandı
    await bosalt()
    expect(mesaj(3)).toBeNull()
    expect(mesaj(2).querySelector('.msg-text').textContent).toContain('iki-düzenli')
    expect(mesaj(2).querySelector('.msg-edited')).not.toBeNull()
    expect(metinler()[0]).toBe('bir')
  })
  it('uzlaştırma sürerken eklenen yeni mesaj silinmiş sanılmaz', async () => {
    await kur([ms(1, 'u2', 'bir')])
    fake.subCbs[0]('SUBSCRIBED')
    fake.subCbs[0]('SUBSCRIBED')
    olay('INSERT')({ new: ms(5, 'u2', 'sonradan') }) // veritabanı yanıtından ÖNCE canlı geldi
    await bosalt()
    expect(mesaj(5)).not.toBeNull()
  })
  it('açık düzenleme kutusu uzlaştırmada korunur', async () => {
    await kur([ms(1, 'u1', 'benim'), ms(2, 'u2', 'ali')])
    fake.subCbs[0]('SUBSCRIBED')
    mesaj(1).querySelector('[data-act="duzenle"]').click()
    const kutu = document.querySelector('.msg-edit-input')
    kutu.value = 'yarım'
    fake.msgRows[1] = { ...fake.msgRows[1], content: 'ali-düzenli', edited_at: '2026-11-12T11:00:00Z' }
    fake.subCbs[0]('SUBSCRIBED')
    await bosalt()
    expect(document.querySelector('.msg-edit-input')).toBe(kutu)
    expect(kutu.value).toBe('yarım')
    expect(mesaj(2).querySelector('.msg-text').textContent).toContain('ali-düzenli')
  })
})
