// @vitest-environment jsdom
// Kendi profil kartı, kullanıcı çubuğunda isim, ayarlarda hesap kartı (tasarım turu 3, Görev 2)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openProfileCard, closeProfileCard, installProfileCards } from '../src/ui/profileCard.js'
import { renderChannelList } from '../src/ui/channelList.js'
import { openSettings } from '../src/ui/settings.js'

const UZUN = 'cok-uzun-bir-kullanici-adi' // 24+ karakter
const ben = { id: 'u1', username: UZUN, color: '#5b7cfa', avatar_url: null }
const kart = () => document.querySelector('.profile-card')

beforeEach(() => {
  closeProfileCard()
  document.body.innerHTML = ''
  localStorage.clear()
})

function cubukCiz(ek = {}) {
  const kok = document.createElement('div')
  document.body.appendChild(kok)
  const panel = document.createElement('aside')
  kok.appendChild(panel)
  renderChannelList(panel, { server: null, channels: [], profile: ben, selectedChannelId: null, handlers: {}, ...ek })
  return { kok, panel }
}

describe('kendi profil kartı', () => {
  function ac(ek = {}) {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const own = { onStatus: vi.fn(), onEdit: vi.fn() }
    openProfileCard({ person: ben, status: 'online', own, opener, ...ek })
    return { opener, own }
  }

  it('durum seçimi ve "Profili düzenle" var; uzun ad textContent ile basılır', () => {
    ac()
    expect(kart().querySelector('.profile-card-name').textContent).toBe(UZUN)
    const secenekler = [...kart().querySelectorAll('.profile-card-choice')]
    expect(secenekler.map((b) => b.textContent)).toEqual(['Çevrimiçi', 'Rahatsız etmeyin'])
    expect(secenekler.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    expect(kart().querySelector('.profile-card-edit').textContent).toBe('Profili düzenle')
  })

  it('"Rahatsız etmeyin" onStatus(true) çağırır ve kartı hemen günceller; "Çevrimiçi" geri alır', () => {
    const { own } = ac()
    kart().querySelector('[data-durum=dnd]').click()
    expect(own.onStatus).toHaveBeenLastCalledWith(true)
    expect(kart().querySelector('[data-durum=dnd]').getAttribute('aria-pressed')).toBe('true')
    expect(kart().querySelector('.profile-card-status').textContent).toContain('Rahatsız etmeyin')
    kart().querySelector('[data-durum=online]').click()
    expect(own.onStatus).toHaveBeenLastCalledWith(false)
    expect(kart().querySelector('.profile-card-status').textContent).toContain('Çevrimiçi')
  })

  it('"Profili düzenle" kartı kapatır ve onEdit çağırır', () => {
    const { own } = ac()
    kart().querySelector('.profile-card-edit').click()
    expect(kart()).toBeNull()
    expect(own.onEdit).toHaveBeenCalledTimes(1)
  })

  it('Esc kapatır ve odak açan öğeye döner; dışarı tıklayınca kapanır', () => {
    const { opener } = ac()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(kart()).toBeNull()
    expect(document.activeElement).toBe(opener)
    ac()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(kart()).toBeNull()
  })

  it('başkasının kartında durum seçimi ve düzenle düğmesi yok', () => {
    openProfileCard({ person: { id: 'u2', username: 'ali', color: '#e05b5b' }, status: 'online' })
    expect(kart().querySelector('.profile-card-own')).toBeNull()
  })
})

describe('kullanıcı çubuğu', () => {
  it('uzun ad title ile tam görünür; ikinci satır durum adı ya da durum yazısı', () => {
    const { panel } = cubukCiz({ myStatus: 'dnd' })
    expect(panel.querySelector('.user-info').title).toBe(UZUN)
    expect(panel.querySelector('.user-name').textContent).toBe(UZUN)
    expect(panel.querySelector('.user-sub').textContent).toBe('Rahatsız etmeyin')
    const { panel: p2 } = cubukCiz({ myStatus: 'online', myStatusText: 'Akşam 21.00 Lobi' })
    expect(p2.querySelector('.user-sub').textContent).toBe('Akşam 21.00 Lobi')
  })

  it('avatara ya da isme tıklayınca kendi kartı açılır; dişli Ayarlar çağırır', () => {
    const onSettings = vi.fn()
    const { kok, panel } = cubukCiz({ handlers: { onSettings } })
    const getInfo = (kisi) => ({ status: 'online', statusText: '', voiceChannelName: null, own: kisi.id === ben.id ? { onStatus() {}, onEdit() {} } : null })
    installProfileCards(kok, getInfo)
    panel.querySelector('.user-bar .avatar-wrap').click()
    expect(kart().querySelector('.profile-card-own')).not.toBeNull()
    closeProfileCard()
    panel.querySelector('.user-info').click()
    expect(kart().querySelector('.profile-card-name').textContent).toBe(UZUN)
    closeProfileCard()
    panel.querySelector('button[title="Ayarlar"]').click()
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(kart()).toBeNull()
  })

  it('sustur, sağırlaştır ve dişli çubukta üç düğme olarak kalır', () => {
    const { panel } = cubukCiz()
    expect(panel.querySelectorAll('.user-bar button').length).toBe(3)
  })
})

describe('ayarlar > hesap kartı', () => {
  const sekmeHesap = () => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Hesap').click()

  it('avatar, ad, soluk e-posta ve "Profili düzenle"; uzun ad ve e-posta title taşır', () => {
    const onProfile = vi.fn()
    openSettings({ onProfile, account: { profile: ben, email: 'cok.uzun.bir.eposta.adresi.burada@ornek.com' } })
    sekmeHesap()
    const k = document.querySelector('.account-card')
    expect(k.querySelector('.account-avatar').textContent).toBe('C')
    expect(k.querySelector('.account-name').textContent).toBe(UZUN)
    expect(k.querySelector('.account-name').title).toBe(UZUN)
    expect(k.querySelector('.account-email').textContent).toBe('cok.uzun.bir.eposta.adresi.burada@ornek.com')
    const duzenle = [...k.querySelectorAll('button')].find((b) => b.textContent === 'Profili düzenle')
    duzenle.click()
    expect(onProfile).toHaveBeenCalledTimes(1)
  })

  it('"Çıkış yap" kartın dışında, kendi satırında durur ve yine onay sorar', () => {
    const onSignOut = vi.fn()
    openSettings({ onSignOut, account: { profile: ben, email: 'a@b.com' } })
    sekmeHesap()
    const cikis = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Çıkış yap')
    expect(cikis.closest('.account-signout')).not.toBeNull()
    expect(cikis.closest('.account-card')).toBeNull()
    cikis.click()
    expect(onSignOut).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Çıkış yapılsın mı?')
  })
})
