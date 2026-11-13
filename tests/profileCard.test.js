// @vitest-environment jsdom
// Avatara tıklayınca açılan küçük profil kartı (tasarım turu 2, U06)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openProfileCard, closeProfileCard, profileCardPosition, makeProfileOpener, installProfileCards } from '../src/ui/profileCard.js'
import { renderMemberList } from '../src/ui/memberList.js'
import { renderMessage } from '../src/ui/chatView.js'
import { renderChannelList, voiceMembersByChannel } from '../src/ui/channelList.js'

const ali = { id: 'u2', username: 'ali', color: '#e05b5b', avatar_url: null }
const kart = () => document.querySelector('.profile-card')

function acan() {
  const b = document.createElement('button')
  b.textContent = 'aç'
  document.body.appendChild(b)
  b.focus()
  return b
}

beforeEach(() => {
  closeProfileCard()
  document.body.innerHTML = ''
})

describe('profil kartı', () => {
  it('büyük avatar, ad, durum noktası + yazısı, durum metni ve sesli kanal', () => {
    openProfileCard({ person: ali, status: 'dnd', statusText: 'Akşam 21.00', voiceChannelName: 'Lobi', opener: acan() })
    const k = kart()
    expect(k.getAttribute('role')).toBe('dialog')
    expect(k.querySelector('.profile-card-avatar').textContent).toBe('A')
    expect(k.querySelector('.status-dot').dataset.status).toBe('dnd')
    expect(k.querySelector('.profile-card-name').textContent).toBe('ali')
    expect(k.textContent).toContain('Rahatsız etmeyin')
    expect(k.textContent).toContain('Akşam 21.00')
    expect(k.querySelector('.profile-card-voice').textContent).toContain('Lobi')
  })

  it('sesli kanalda değilse kanal satırı yok; çevrimdışı yazısı', () => {
    openProfileCard({ person: ali, status: 'offline', opener: acan() })
    expect(kart().querySelector('.profile-card-voice')).toBeNull()
    expect(kart().textContent).toContain('Çevrimdışı')
  })

  it('kullanıcı yazısı HTML olarak çalışmaz', () => {
    const kotu = { ...ali, username: '<img src=x onerror=alert(1)>' }
    openProfileCard({ person: kotu, status: 'online', statusText: '<b>kalın</b>', voiceChannelName: '<i>x</i>', opener: acan() })
    expect(kart().querySelector('img')).toBeNull()
    expect(kart().querySelector('b, i')).toBeNull()
    expect(kart().querySelector('.profile-card-name').textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('odak karta girer; Esc kapatır ve odak açan öğeye döner', () => {
    const a = acan()
    openProfileCard({ person: ali, status: 'online', opener: a })
    expect(kart().contains(document.activeElement)).toBe(true)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(kart()).toBeNull()
    expect(document.activeElement).toBe(a)
  })

  it('açan öğe yeniden çizildiyse odak aynı anahtarlı yeni öğeye döner', () => {
    const a = acan()
    a.dataset.odak = 'profil-x'
    openProfileCard({ person: ali, status: 'online', opener: a })
    a.remove()
    const yeni = document.createElement('button')
    yeni.dataset.odak = 'profil-x'
    document.body.appendChild(yeni)
    closeProfileCard({ returnFocus: true })
    expect(document.activeElement).toBe(yeni)
  })

  it('dışarı tıklayınca kapanır; içeri tıklayınca kapanmaz', () => {
    openProfileCard({ person: ali, status: 'online', opener: acan() })
    kart().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(kart()).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(kart()).toBeNull()
  })

  it('M1: kaydırma kartı kapatmaz (sohbet kendiliğinden kayar); açan öğe kalktıysa da kapanmaz', () => {
    const a = acan()
    openProfileCard({ person: ali, status: 'online', opener: a })
    window.dispatchEvent(new Event('scroll'))
    document.body.dispatchEvent(new Event('scroll'))
    expect(kart()).not.toBeNull()
    a.remove() // liste yeniden çizildi
    window.dispatchEvent(new Event('scroll'))
    expect(kart()).not.toBeNull()
  })

  it('M1: kaydırınca kart açan öğeyle birlikte yer değiştirir', () => {
    const a = acan()
    let ust = 100
    a.getBoundingClientRect = () => ({ left: 50, right: 82, top: ust, bottom: ust + 32 })
    openProfileCard({ person: ali, status: 'online', opener: a })
    const once = kart().style.top
    ust = 300
    window.dispatchEvent(new Event('scroll'))
    expect(kart().style.top).not.toBe(once)
  })

  it('aynı anda tek kart', () => {
    openProfileCard({ person: ali, status: 'online', opener: acan() })
    openProfileCard({ person: { ...ali, id: 'u3', username: 'can' }, status: 'online', opener: acan() })
    expect(document.querySelectorAll('.profile-card')).toHaveLength(1)
    expect(kart().querySelector('.profile-card-name').textContent).toBe('can')
  })
})

describe('kartın konumu ekrana sığar', () => {
  const pencere = { width: 1000, height: 700 }
  const boyut = { width: 260, height: 200 }
  it('yer varsa tıklanan öğenin sağında, üst kenarı hizalı', () => {
    expect(profileCardPosition({ left: 100, right: 132, top: 300, bottom: 332 }, boyut, pencere)).toEqual({ left: 140, top: 300 })
  })
  it('sağda yer yoksa solunda', () => {
    expect(profileCardPosition({ left: 900, right: 932, top: 300, bottom: 332 }, boyut, pencere)).toEqual({ left: 632, top: 300 })
  })
  it('alttan taşacaksa yukarı kayar; hiçbir zaman kenardan dışarı çıkmaz', () => {
    expect(profileCardPosition({ left: 100, right: 132, top: 650, bottom: 682 }, boyut, pencere).top).toBe(492)
    const dar = profileCardPosition({ left: 5, right: 20, top: -50, bottom: 0 }, boyut, { width: 270, height: 150 })
    expect(dar.left).toBeGreaterThanOrEqual(8)
    expect(dar.top).toBe(8)
  })
})

describe('avatarlar kartı açar', () => {
  function kur(kok, bilgi = () => ({ status: 'online' })) {
    document.body.appendChild(kok)
    return installProfileCards(kok, bilgi)
  }

  it('işaretli öğe düğme gibi davranır: tık ve Enter kartı açar, ikinci tık kapatır', () => {
    const kok = document.createElement('div')
    const av = document.createElement('span')
    makeProfileOpener(av, ali, 'profil-test')
    kok.appendChild(av)
    const birak = kur(kok, (kisi) => ({ status: 'online', statusText: '', voiceChannelName: kisi.id === 'u2' ? 'Lobi' : null }))
    expect(av.getAttribute('role')).toBe('button')
    expect(av.tabIndex).toBe(0)
    expect(av.getAttribute('aria-label')).toBe('ali profilini göster')
    av.click()
    expect(kart().querySelector('.profile-card-voice').textContent).toContain('Lobi')
    av.click()
    expect(kart()).toBeNull()
    av.focus()
    av.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(kart()).not.toBeNull()
    birak()
  })

  it('üye listesi, sohbet mesajı ve sesli kanaldaki kişi işaretlidir', () => {
    const uyeler = document.createElement('aside')
    renderMemberList(uyeler, { members: [ali], presence: new Map([['u2', { status: 'online' }]]) })
    expect(uyeler.querySelector('[data-profile-opener]')).not.toBeNull()

    const mesaj = renderMessage({ id: 7, content: 'selam', created_at: new Date().toISOString(), author_id: 'u2' }, ali)
    expect(mesaj.querySelector('.msg-avatar').hasAttribute('data-profile-opener')).toBe(true)
    expect(mesaj.querySelector('.msg-author').hasAttribute('data-profile-opener')).toBe(true)

    const panel = document.createElement('aside')
    const vs = new Map([['u2', { channelId: 'v' }]])
    renderChannelList(panel, {
      server: { id: 's', name: 'S', owner_id: 'u1' },
      channels: [{ id: 'v', name: 'Lobi', kind: 'voice', position: 0 }],
      profile: { id: 'u1', username: 'berk', color: '#5b7cfa' },
      voiceMembers: voiceMembersByChannel([ali], vs, new Map([['u2', {}]])),
      voiceStates: vs,
      handlers: {},
    })
    expect(panel.querySelector('.voice-member [data-profile-opener]')).not.toBeNull()

    // Delege dinleyici: üye listesindeki avatara tıklayınca kart açılır
    const birak = kur(uyeler)
    uyeler.querySelector('[data-profile-opener]').click()
    expect(kart().querySelector('.profile-card-name').textContent).toBe('ali')
    birak()
  })
})

describe('düzeltme turu 1', () => {
  it('üye listesi yeniden çizilince sunucusuz sınıfı korunur', () => {
    const panel = document.createElement('aside')
    panel.classList.add('member-panel', 'sunucusuz')
    renderMemberList(panel, { members: [], presence: new Map() })
    expect(panel.classList.contains('sunucusuz')).toBe(true)
    expect(panel.classList.contains('member-panel')).toBe(true)
  })

  it('üye listesi yeniden çizilince odaktaki avatar yine odakta; odak dışarıdaysa çalınmaz', () => {
    const panel = document.createElement('aside')
    const disari = document.createElement('input')
    document.body.append(panel, disari)
    const ciz = () => renderMemberList(panel, { members: [ali], presence: new Map([['u2', { status: 'online' }]]) })
    ciz()
    const eski = panel.querySelector('[data-profile-opener]')
    eski.focus()
    ciz()
    const yeni = panel.querySelector('[data-profile-opener]')
    expect(yeni).not.toBe(eski)
    expect(document.activeElement).toBe(yeni)
    disari.focus()
    ciz()
    expect(document.activeElement).toBe(disari)
  })

  it('M4: sohbet avatarı Tab durağı değil (tabindex -1) ama yine düğme gibi ve kartı açar', () => {
    const mesaj = renderMessage({ id: 9, content: 'x', created_at: new Date().toISOString(), author_id: 'u2' }, ali)
    const av = mesaj.querySelector('.msg-avatar')
    expect(av.tabIndex).toBe(-1)
    expect(av.getAttribute('role')).toBe('button')
    document.body.appendChild(mesaj)
    const birak = installProfileCards(mesaj, () => ({ status: 'online' }))
    av.click()
    expect(kart()).not.toBeNull()
    birak()
  })

  it('sohbette yazar adı görünür adını korur (role/aria-label yok) ama kartı açar', () => {
    const mesaj = renderMessage({ id: 8, content: 'x', created_at: new Date().toISOString(), author_id: 'u2' }, ali)
    const ad = mesaj.querySelector('.msg-author')
    expect(ad.hasAttribute('aria-label')).toBe(false)
    expect(ad.hasAttribute('role')).toBe(false)
    expect(ad.hasAttribute('tabindex')).toBe(false)
    expect(mesaj.querySelector('.msg-avatar').getAttribute('role')).toBe('button')
    document.body.appendChild(mesaj)
    const birak = installProfileCards(mesaj, () => ({ status: 'online' }))
    ad.click()
    expect(kart().querySelector('.profile-card-name').textContent).toBe('ali')
    birak()
  })
})

describe('profil kartı: arkadaşlık ve mesaj düğmeleri (Ana sayfa, spec §1)', () => {
  const dugmeler = () => [...kart().querySelectorAll('.profile-card-social button')].map((b) => [b.textContent, b.disabled])
  const bekle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

  it('arkadaş değil, sunucu arkadaşı: Mesaj gönder + Arkadaş ekle', () => {
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'none', canMessage: true } })
    expect(dugmeler()).toEqual([['Mesaj gönder', false], ['Arkadaş ekle', false]])
  })

  it('arkadaş: yalnız Mesaj gönder; istek gönderilmiş: İstek gönderildi (pasif)', () => {
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'friend', canMessage: true } })
    expect(dugmeler()).toEqual([['Mesaj gönder', false]])
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'outgoing', canMessage: false } })
    expect(dugmeler()).toEqual([['İstek gönderildi', true]])
  })

  it('social yoksa (engellenmiş kişi) ya da kendi kartımızda düğme yok', () => {
    openProfileCard({ person: ali, status: 'online', opener: acan() })
    expect(kart().querySelector('.profile-card-social')).toBeNull()
    openProfileCard({ person: ali, status: 'online', opener: acan(), own: {}, social: { friend: 'none', canMessage: true } })
    expect(kart().querySelector('.profile-card-social')).toBeNull()
  })

  it('Arkadaş ekle -> istek gider, düğme "İstek gönderildi" olur', async () => {
    const onAdd = vi.fn(async () => 'sent')
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'none', canMessage: false, onAdd } })
    kart().querySelector('.profile-card-friend').click()
    await bekle()
    expect(onAdd).toHaveBeenCalled()
    expect(dugmeler()).toEqual([['İstek gönderildi', true]])
  })

  it('karşı taraf zaten istemişse arkadaş olunur: Mesaj gönder çıkar', async () => {
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'none', canMessage: false, onAdd: async () => 'accepted' } })
    kart().querySelector('.profile-card-friend').click()
    await bekle()
    expect(dugmeler()).toEqual([['Mesaj gönder', false]])
  })

  it('hata olursa kartta Türkçe metin, düğme yeniden basılabilir', async () => {
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'none', canMessage: false, onAdd: async () => { throw new Error('Böyle bir kullanıcı yok.') } } })
    kart().querySelector('.profile-card-friend').click()
    await bekle()
    expect(kart().querySelector('.profile-card-error').textContent).toBe('Böyle bir kullanıcı yok.')
    expect(dugmeler()).toEqual([['Arkadaş ekle', false]])
  })

  it('Mesaj gönder kartı kapatır ve onMessage çağırır', () => {
    const onMessage = vi.fn()
    openProfileCard({ person: ali, status: 'online', opener: acan(), social: { friend: 'friend', canMessage: true, onMessage } })
    kart().querySelector('.profile-card-message').click()
    expect(onMessage).toHaveBeenCalled()
    expect(kart()).toBeNull()
  })
})
