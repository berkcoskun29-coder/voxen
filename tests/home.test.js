// @vitest-environment jsdom
// Ana sayfa (spec §1): sol sütun (Arkadaşlar + ÖZEL MESAJLAR) ve Arkadaşlar sayfası.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  renderHomeSidebar, createFriendsPage, sortDms, dmUnreadTotal, durumYazisi, HOME_TEXTS,
} from '../src/ui/home.js'
import { closeMenu } from '../src/ui/serverMenu.js'

const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const veli = { id: 'u3', username: 'veli', color: '#5b7cfa', avatar_url: null }
const ayse = { id: 'u4', username: 'ayşe', color: '#3be37a', avatar_url: null }

const dm = (id, other, ek = {}) => ({ id, other, createdAt: '2026-11-01T00:00:00Z', lastMessageAt: null, unread: 0, canSend: true, ...ek })
const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  closeMenu()
  document.body.innerHTML = ''
})

describe('yardımcılar', () => {
  it('DM listesi son mesaja göre sıralanır, en yenisi üstte (mesajsızda açılış zamanı)', () => {
    const l = sortDms([
      dm('t1', ali, { lastMessageAt: '2026-11-10T10:00:00Z' }),
      dm('t2', veli, { lastMessageAt: '2026-11-12T10:00:00Z' }),
      dm('t3', ayse, { createdAt: '2026-11-11T10:00:00Z' }),
    ])
    expect(l.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('okunmamış DM toplamı', () => {
    expect(dmUnreadTotal([dm('t1', ali, { unread: 2 }), dm('t2', veli, { unread: 3 }), dm('t3', ayse)])).toBe(5)
    expect(dmUnreadTotal([])).toBe(0)
  })

  it('durum yazısı: durum mesajı varsa o, yoksa durum adı', () => {
    const p = new Map([['u2', { status: 'dnd', statusText: '' }], ['u3', { status: 'online', statusText: 'Oyunda' }]])
    expect(durumYazisi(p, 'u2')).toBe('Rahatsız etmeyin')
    expect(durumYazisi(p, 'u3')).toBe('Oyunda')
    expect(durumYazisi(p, 'u4')).toBe('Çevrimdışı')
  })
})

describe('sol sütun', () => {
  it('üstte Arkadaşlar satırı, altında ÖZEL MESAJLAR ve son mesaja göre sıralı DM satırları', () => {
    const el = renderHomeSidebar({
      dms: [dm('t1', ali, { lastMessageAt: '2026-11-10T00:00:00Z' }), dm('t2', veli, { lastMessageAt: '2026-11-12T00:00:00Z' })],
    })
    expect(el.querySelector('.home-friends').textContent).toContain('Arkadaşlar')
    expect(el.querySelector('.home-friends').classList.contains('selected')).toBe(true)
    expect(el.querySelector('.section-title').textContent).toBe('ÖZEL MESAJLAR')
    expect([...el.querySelectorAll('.dm-name')].map((e) => e.textContent)).toEqual(['veli', 'ali'])
  })

  it('okunmamış DM kalın (unread) ve sağında sayı; durum noktası varlıktan', () => {
    const el = renderHomeSidebar({
      dms: [dm('t1', ali, { unread: 3 }), dm('t2', veli)],
      presence: new Map([['u2', { status: 'online' }]]),
    })
    const [a, v] = el.querySelectorAll('.dm-item')
    expect(a.classList.contains('unread')).toBe(true)
    expect(a.querySelector('.unread-count').textContent).toBe('3')
    expect(a.getAttribute('aria-label')).toBe('ali, 3 okunmamış mesaj')
    expect(a.querySelector('.status-dot').dataset.status).toBe('online')
    expect(v.classList.contains('unread')).toBe(false)
    expect(v.querySelector('.unread-count')).toBeNull()
    expect(v.querySelector('.status-dot').dataset.status).toBe('offline')
  })

  it('satıra tıklayınca DM açılır, × gizler; seçili DM işaretli', () => {
    const onOpenDm = vi.fn()
    const onHideDm = vi.fn()
    const onFriends = vi.fn()
    const t1 = dm('t1', ali)
    const el = renderHomeSidebar({ dms: [t1], view: { tur: 'dm', thread: t1 }, handlers: { onOpenDm, onHideDm, onFriends } })
    expect(el.querySelector('.home-friends').classList.contains('selected')).toBe(false)
    expect(el.querySelector('.dm-item').classList.contains('selected')).toBe(true)
    el.querySelector('.dm-item').click()
    expect(onOpenDm).toHaveBeenCalledWith(t1)
    el.querySelector('.dm-hide').click()
    expect(onHideDm).toHaveBeenCalledWith(t1)
    expect(el.querySelector('.dm-hide').getAttribute('aria-label')).toBe('ali konuşmasını gizle')
    el.querySelector('.home-friends').click()
    expect(onFriends).toHaveBeenCalled()
  })

  it('kullanıcı adı HTML olarak çalışmaz', () => {
    const el = renderHomeSidebar({ dms: [dm('t1', { ...ali, username: '<img src=x onerror=alert(1)>' })] })
    expect(el.querySelector('.dm-name img')).toBeNull()
    expect(el.querySelector('.dm-name').textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

// Sayfayı kurup belgeye koyar (odak ve menü konumları için)
function sayfaKur(handlers = {}) {
  const s = createFriendsPage({ handlers })
  document.body.append(s.header, s.body)
  return s
}
const sekme = (s, ad) => [...s.header.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith(ad))
const veri = (ek = {}) => ({ friends: [], incoming: [], outgoing: [], blocked: [], presence: new Map(), ...ek })

describe('Arkadaşlar sayfası', () => {
  it('4 sekme ve sağda yeşil Arkadaş ekle; Çevrimiçi seçili başlar', () => {
    const s = sayfaKur()
    const adlar = [...s.header.querySelectorAll('[role="tab"]')].map((b) => b.firstChild.textContent)
    expect(adlar).toEqual(['Çevrimiçi', 'Tümü', 'Bekleyen', 'Engellenen'])
    expect(sekme(s, 'Çevrimiçi').getAttribute('aria-selected')).toBe('true')
    expect(s.header.querySelector('.add-friend-btn').textContent).toBe('Arkadaş ekle')
  })

  it('Çevrimiçi yalnız çevrimiçi arkadaşları gösterir; satırda durum yazısı', () => {
    const s = sayfaKur()
    s.update(veri({ friends: [ali, veli], presence: new Map([['u2', { status: 'dnd', statusText: '' }]]) }))
    const satirlar = s.body.querySelectorAll('.friend-row')
    expect(satirlar).toHaveLength(1)
    expect(satirlar[0].querySelector('.friend-name').textContent).toBe('ali')
    expect(satirlar[0].querySelector('.friend-sub').textContent).toBe('Rahatsız etmeyin')
    expect(s.body.querySelector('.friends-count').textContent).toBe('Çevrimiçi — 1')
    sekme(s, 'Tümü').click()
    expect(s.body.querySelectorAll('.friend-row')).toHaveLength(2)
    expect(s.body.querySelectorAll('.friend-row')[1].querySelector('.friend-sub').textContent).toBe('Çevrimdışı')
  })

  it('boş durumlar: Çevrimiçi ve Tümü metinleri; Tümü\'deki düğme Arkadaş ekle kutusunu açar', () => {
    const s = sayfaKur()
    s.update(veri({ friends: [veli] }))
    expect(s.body.textContent).toBe('Şu an çevrimiçi arkadaşın yok.')
    s.update(veri({ friends: [] }))
    sekme(s, 'Tümü').click()
    expect(s.body.querySelector('.friends-empty-text').textContent).toBe('Henüz arkadaşın yok. Kullanıcı adıyla ekleyebilirsin.')
    s.body.querySelector('.friends-empty-add').click()
    expect(s.tab()).toBe('add')
    expect(s.body.querySelector('input').placeholder).toBe('Kullanıcı adını yaz')
    expect(document.activeElement).toBe(s.body.querySelector('input'))
  })

  it('henüz yüklenmediyse boş durum yazısı çıkmaz; yüklenemediyse söylenir', () => {
    const s = sayfaKur()
    s.update({ friends: null })
    expect(s.body.textContent).toBe('')
    s.update({ friends: null, error: true })
    expect(s.body.textContent).toBe(HOME_TEXTS.yuklenemedi)
  })

  it('💬 Mesaj ve ⋯ menüsü (Arkadaşlıktan çıkar, Engelle: onaydan sonra)', async () => {
    const onMessage = vi.fn()
    const onRemove = vi.fn(async () => {})
    const onBlock = vi.fn(async () => {})
    const s = sayfaKur({ onMessage, onRemove, onBlock })
    s.update(veri({ friends: [ali], presence: new Map([['u2', { status: 'online' }]]) }))
    s.body.querySelector('.friend-message').click()
    expect(onMessage).toHaveBeenCalledWith(ali)
    s.body.querySelector('.friend-more').click()
    const ogeler = [...document.querySelectorAll('.popup-item')]
    expect(ogeler.map((o) => o.textContent)).toEqual(['Arkadaşlıktan çıkar', 'Engelle'])
    ogeler[0].click()
    expect(onRemove).not.toHaveBeenCalled() // önce onay
    expect(document.querySelector('.modal-title').textContent).toBe('Arkadaşlıktan çıkar')
    document.querySelector('.modal-foot .danger').click()
    await bosalt()
    expect(onRemove).toHaveBeenCalledWith(ali)
    expect(document.querySelector('.modal-card')).toBeNull()
    s.body.querySelector('.friend-more').click()
    document.querySelectorAll('.popup-item')[1].click()
    document.querySelector('.modal-foot .danger').click()
    await bosalt()
    expect(onBlock).toHaveBeenCalledWith(ali)
  })

  it('onay penceresinde hata olursa pencere açık kalır ve Türkçe metin yazar', async () => {
    const s = sayfaKur({ onRemove: async () => { throw new Error('Bu istek artık geçerli değil.') } })
    s.update(veri({ friends: [ali], presence: new Map([['u2', { status: 'online' }]]) }))
    s.body.querySelector('.friend-more').click()
    document.querySelector('.popup-item').click()
    document.querySelector('.modal-foot .danger').click()
    await bosalt()
    expect(document.querySelector('.modal-card')).not.toBeNull()
    expect(document.querySelector('.modal-body .error').textContent).toBe('Bu istek artık geçerli değil.')
  })

  it('Bekleyen: gelen istekte Kabul et / Reddet, gidende "Giden istek" ve İptal; rozette gelen sayısı', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    const s = sayfaKur({ onAccept, onDecline })
    s.update(veri({ incoming: [ali, ayse], outgoing: [veli] }))
    expect(sekme(s, 'Bekleyen').querySelector('.tab-badge').textContent).toBe('2')
    expect(sekme(s, 'Bekleyen').querySelector('.tab-badge').hidden).toBe(false)
    sekme(s, 'Bekleyen').click()
    const satirlar = [...s.body.querySelectorAll('.friend-row')]
    expect(satirlar.map((r) => r.querySelector('.friend-sub').textContent)).toEqual(['Gelen istek', 'Gelen istek', 'Giden istek'])
    satirlar[0].querySelector('.friend-accept').click()
    expect(onAccept).toHaveBeenCalledWith(ali)
    expect(satirlar[0].querySelector('.friend-accept').getAttribute('aria-label')).toBe('Kabul et')
    satirlar[1].querySelector('.friend-decline').click()
    expect(onDecline).toHaveBeenCalledWith(ayse)
    expect(satirlar[2].querySelector('.friend-accept')).toBeNull()
    expect(satirlar[2].querySelector('.friend-cancel').getAttribute('aria-label')).toBe('İptal')
    satirlar[2].querySelector('.friend-cancel').click()
    expect(onDecline).toHaveBeenCalledWith(veli)
    s.update(veri())
    expect(sekme(s, 'Bekleyen').querySelector('.tab-badge').hidden).toBe(true)
  })

  it('Engellenen: Engeli kaldır', () => {
    const onUnblock = vi.fn()
    const s = sayfaKur({ onUnblock })
    s.update(veri({ blocked: [veli] }))
    sekme(s, 'Engellenen').click()
    s.body.querySelector('.friend-unblock').click()
    expect(onUnblock).toHaveBeenCalledWith(veli)
  })

  it('Arkadaş ekle: boşken düğme pasif; sonuç yazıları kutunun altında', async () => {
    let cevap = async () => 'sent'
    const onSend = vi.fn((ad) => cevap(ad))
    const s = sayfaKur({ onSend })
    s.header.querySelector('.add-friend-btn').click()
    const kutu = s.body.querySelector('input')
    const dugme = s.body.querySelector('button[type="submit"]')
    const sonuc = s.body.querySelector('.add-friend-result')
    expect(dugme.textContent).toBe('İstek gönder')
    expect(dugme.disabled).toBe(true)
    kutu.value = '  ali '
    kutu.dispatchEvent(new Event('input'))
    expect(dugme.disabled).toBe(false)
    dugme.click()
    await bosalt()
    expect(onSend).toHaveBeenCalledWith('ali')
    expect(sonuc.textContent).toBe('İstek gönderildi.')
    expect(sonuc.dataset.tur).toBe('basari')
    expect(kutu.value).toBe('')

    cevap = async () => { throw new Error('Böyle bir kullanıcı yok.') }
    kutu.value = 'kimse'
    kutu.dispatchEvent(new Event('input'))
    expect(sonuc.textContent).toBe('') // yazmaya başlayınca eski sonuç silinir
    dugme.click()
    await bosalt()
    expect(sonuc.textContent).toBe('Böyle bir kullanıcı yok.')
    expect(sonuc.dataset.tur).toBe('hata')
    expect(kutu.value).toBe('kimse') // hatada yazılan kalır

    cevap = async () => 'accepted'
    dugme.click()
    await bosalt()
    expect(sonuc.textContent).toBe('Artık arkadaşsınız.')
  })

  it('veri yenilenince yazılan kullanıcı adı ve seçili görünüm kaybolmaz', () => {
    const s = sayfaKur()
    s.showTab('add')
    const kutu = s.body.querySelector('input')
    kutu.value = 'yar'
    s.update(veri({ friends: [ali] }))
    expect(s.body.querySelector('input')).toBe(kutu)
    expect(kutu.value).toBe('yar')
    expect(s.tab()).toBe('add')
  })

  it('liste yenilenince odaktaki satır düğmesi yeni düğmede odakta kalır', () => {
    const s = sayfaKur()
    const v = veri({ friends: [ali], presence: new Map([['u2', { status: 'online' }]]) })
    s.update(v)
    s.body.querySelector('.friend-message').focus()
    s.update(v)
    expect(document.activeElement).toBe(s.body.querySelector('.friend-message'))
  })
})

describe('arkadaş listesi: açık menü varken varlık olayı', () => {
  it('menü A açıkken varlık olayı, sonra 2. arkadaşın ⋯ düğmesine basış: menü B bağlı düğmeye çıpalı açılır', async () => {
    const s = sayfaKur({})
    document.body.appendChild(s.body)
    s.showTab('all')
    s.update(veri({ friends: [ali, veli], presence: new Map() }))
    const dugmeler = () => [...s.body.querySelectorAll('.friend-more')]
    const [d1, d2] = dugmeler()
    d1.click()
    const menuA = document.querySelector('.popup-menu')
    expect(menuA).not.toBeNull()
    s.update(veri({ friends: [ali, veli], presence: new Map([['u2', { status: 'online' }]]) }))
    expect(dugmeler()[1]).toBe(d2) // menü açıkken çizilmedi
    // 2. düğmeye gerçek basış: önce fare basılır (menü A kapanır), sonra tıklanır
    d2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.popup-menu')).toBeNull()
    expect(dugmeler()[1]).toBe(d2) // basış sürerken düğme değişmedi
    d2.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    d2.click()
    const menuB = document.querySelector('.popup-menu')
    expect(menuB).not.toBeNull()
    expect(d2.isConnected).toBe(true)
    expect(d2.getAttribute('aria-expanded')).toBe('true')
    await bosalt()
    // Menü B hâlâ açık: ertelenmiş çizim yapılmadı
    expect(document.querySelector('.popup-menu')).toBe(menuB)
    expect(dugmeler()[1]).toBe(d2)
    closeMenu()
    await bosalt()
    expect(s.body.querySelector('.friend-row .status-dot').dataset.status).toBe('online') // sonunda çizildi
  })
})
