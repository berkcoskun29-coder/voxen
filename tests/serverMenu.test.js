// @vitest-environment jsdom
// Sunucu/kanal menüsü: konum, Esc/Tab/dışarı tıklama, odak dönüşü ve pencereler.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  menuPosition, openServerMenu, openChannelMenu, closeMenu, leaveServerDialog, deleteServerDialog,
  deleteChannelDialog, renameChannelDialog, serverSettingsDialog,
} from '../src/ui/serverMenu.js'

beforeEach(() => {
  closeMenu()
  document.body.innerHTML = ''
})

function dugmeKur() {
  const d = document.createElement('button')
  d.textContent = 'Sunucu'
  d.dataset.odak = 'sunucu-menu'
  document.body.appendChild(d)
  d.focus()
  return d
}
const ogeler = () => [...document.querySelectorAll('.popup-menu [role=menuitem]')]
const tus = (key, hedef = document.activeElement) => hedef.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

describe('menuPosition', () => {
  const pencere = { width: 1000, height: 600 }
  it('altta, sol kenar hizalı', () => {
    expect(menuPosition({ left: 20, right: 200, top: 10, bottom: 50 }, { width: 200, height: 100 }, pencere)).toEqual({ left: 20, top: 54 })
  })
  it('altta yer yoksa üste çıkar, ekranın içinde kalır', () => {
    const p = menuPosition({ left: 20, right: 200, top: 540, bottom: 580 }, { width: 200, height: 100 }, pencere)
    expect(p.top).toBe(436)
  })
  it('yan: sag, yer yoksa sola döner', () => {
    expect(menuPosition({ left: 100, right: 120, top: 30, bottom: 50 }, { width: 200, height: 80 }, pencere, 'sag')).toEqual({ left: 124, top: 30 })
    expect(menuPosition({ left: 900, right: 920, top: 30, bottom: 50 }, { width: 200, height: 80 }, pencere, 'sag').left).toBe(696)
  })
})

describe('sunucu menüsü', () => {
  it('sahip ve üye için doğru öğeler; tehlikeli olanlar kırmızı', () => {
    openServerMenu({ opener: dugmeKur(), sunucu: { name: 'S' }, sahip: true, tik: {} })
    expect(ogeler().map((b) => b.textContent)).toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucu ayarları', 'Kanal ekle', 'Sunucuyu sil'])
    expect(ogeler().filter((b) => b.classList.contains('danger')).map((b) => b.textContent)).toEqual(['Sunucuyu sil'])
    closeMenu()
    openServerMenu({ opener: dugmeKur(), sunucu: { name: 'S' }, sahip: false, tik: {} })
    expect(ogeler().map((b) => b.textContent)).toEqual(['Davet et', 'Sunucuyu sessize al', 'Sunucudan ayrıl'])
    expect(document.querySelector('.popup-menu').getAttribute('role')).toBe('menu')
  })

  it('açılınca ilk öğeye odaklanır; aria-expanded açan düğmede güncellenir', () => {
    const d = dugmeKur()
    openServerMenu({ opener: d, sunucu: { name: 'S' }, sahip: true, tik: {} })
    expect(document.activeElement).toBe(ogeler()[0])
    expect(d.getAttribute('aria-expanded')).toBe('true')
    closeMenu()
    expect(d.getAttribute('aria-expanded')).toBe('false')
  })

  it('Esc kapatır ve odak açan düğmeye döner', () => {
    const d = dugmeKur()
    openServerMenu({ opener: d, sunucu: { name: 'S' }, sahip: true, tik: {} })
    tus('Escape')
    expect(document.querySelector('.popup-menu')).toBeNull()
    expect(document.activeElement).toBe(d)
  })

  it('Tab menüyü kapatır (odak açan düğmeye); aşağı/yukarı ok öğeler arasında döner', () => {
    const d = dugmeKur()
    openServerMenu({ opener: d, sunucu: { name: 'S' }, sahip: true, tik: {} })
    tus('ArrowDown')
    expect(document.activeElement).toBe(ogeler()[1])
    tus('ArrowUp')
    tus('ArrowUp')
    expect(document.activeElement).toBe(ogeler().at(-1))
    tus('Tab')
    expect(document.querySelector('.popup-menu')).toBeNull()
    expect(document.activeElement).toBe(d)
  })

  it('dışarı tıklayınca kapanır; menü içi tıklama kapatmaz', () => {
    openServerMenu({ opener: dugmeKur(), sunucu: { name: 'S' }, sahip: true, tik: {} })
    ogeler()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.popup-menu')).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.popup-menu')).toBeNull()
  })

  it('öğe seçilince menü kapanır ve işlev çalışır; açan düğme yeniden çizilse de odak anahtarla bulunur', () => {
    const onSettings = vi.fn()
    const d = dugmeKur()
    openServerMenu({ opener: d, sunucu: { name: 'S' }, sahip: true, tik: { onSettings } })
    d.remove() // panel yeniden çizildi
    const yeni = dugmeKur()
    ogeler()[2].click()
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.popup-menu')).toBeNull()
    expect(document.activeElement).toBe(yeni)
  })

  it('açan düğmeye ikinci tıklama menüyü kapatır', () => {
    const d = dugmeKur()
    const ac = () => openServerMenu({ opener: d, sunucu: { name: 'S' }, sahip: true, tik: {} })
    ac()
    ac()
    expect(document.querySelector('.popup-menu')).toBeNull()
  })

  it('kullanıcı yazısı (sunucu adı) menü etiketinde HTML olarak çalışmaz', () => {
    openServerMenu({ opener: dugmeKur(), sunucu: { name: '<img src=x onerror=alert(1)>' }, sahip: false, tik: {} })
    expect(document.querySelector('.popup-menu img')).toBeNull()
  })
})

describe('kanal menüsü', () => {
  it('iki öğe: yeniden adlandır ve sil (kırmızı)', () => {
    openChannelMenu({ opener: dugmeKur(), kanal: { name: 'genel' }, tik: {} })
    expect(ogeler().map((b) => b.textContent)).toEqual(['Kanalı yeniden adlandır', 'Kanalı sil'])
    expect(ogeler()[1].classList.contains('danger')).toBe(true)
  })
})

describe('pencereler', () => {
  const dugme = (yazi) => [...document.querySelectorAll('.modal-card button')].find((b) => b.textContent === yazi)

  it('ayrılma onayı: metin ve kırmızı Ayrıl', () => {
    leaveServerDialog({ name: 'Takım' }, async () => null)
    expect(document.querySelector('.modal-card').textContent).toContain('Takım sunucusundan ayrılınsın mı? Davet linkiyle yeniden katılabilirsin.')
    expect(dugme('Ayrıl').className).toBe('danger')
  })

  it('sunucu silme: yalnız aynen yazılınca Sil açılır; boşluk ve büyük/küçük harf farkı sayılır', async () => {
    const sil = vi.fn(async () => null)
    deleteServerDialog({ name: 'Takım' }, sil)
    const kutu = document.querySelector('.modal-card input')
    const d = dugme('Sil')
    expect(d.disabled).toBe(true)
    for (const yanlis of ['takım', 'Takım ', 'Taki']) {
      kutu.value = yanlis
      kutu.dispatchEvent(new Event('input'))
      expect(d.disabled).toBe(true)
    }
    kutu.value = 'Takım'
    kutu.dispatchEvent(new Event('input'))
    expect(d.disabled).toBe(false)
    d.click()
    await Promise.resolve()
    expect(sil).toHaveBeenCalledTimes(1)
  })

  it('sunucu silme: yazı sonradan bozulursa Sil yeniden pasif olur', () => {
    deleteServerDialog({ name: 'Takım' }, async () => null)
    const kutu = document.querySelector('.modal-card input')
    kutu.value = 'Takım'
    kutu.dispatchEvent(new Event('input'))
    kutu.value = 'Takı'
    kutu.dispatchEvent(new Event('input'))
    expect(dugme('Sil').disabled).toBe(true)
  })

  it('sunucu adı kutuda ve metinde textContent ile basılır', () => {
    deleteServerDialog({ name: '<b>x</b>' }, async () => null)
    expect(document.querySelector('.modal-card b')).toBeNull()
  })

  it('kanal silme onay metni', () => {
    deleteChannelDialog({ name: 'genel' }, async () => null)
    expect(document.querySelector('.modal-card').textContent).toContain('#genel kanalı silinsin mi? İçindeki bütün mesajlar silinir.')
  })

  it('kanal adlandırma: boş ad hata verir ve kaydet çağrılmaz; geçerli ad kırpılmış gider', async () => {
    const kaydet = vi.fn(async () => null)
    renameChannelDialog({ name: 'genel' }, kaydet)
    const kutu = document.querySelector('.modal-card input')
    kutu.value = '  '
    dugme('Kaydet').click()
    await vi.waitFor(() => expect(document.querySelector('.field-error').textContent).not.toBe(''))
    expect(kaydet).not.toHaveBeenCalled()
    kutu.value = ' yeni '
    dugme('Kaydet').click()
    await vi.waitFor(() => expect(kaydet).toHaveBeenCalledWith('yeni'))
  })

  it('sunucu ayarları: ad, davet kodu, kopyala düğmesi; 40 karakter sınırı', async () => {
    const kopyala = vi.fn()
    const kaydet = vi.fn(async () => null)
    serverSettingsDialog({ name: 'S', invite_code: 'abc123' }, { kaydet, kopyala })
    expect(document.querySelector('.invite-code').textContent).toBe('abc123')
    dugme('Davet linkini kopyala').click()
    expect(kopyala).toHaveBeenCalled()
    const kutu = document.querySelector('.modal-card input')
    expect(kutu.maxLength).toBe(40)
    kutu.value = ''
    dugme('Kaydet').click()
    await vi.waitFor(() => expect(document.querySelector('.field-error').textContent).toContain('Sunucu adı boş olamaz'))
    expect(kaydet).not.toHaveBeenCalled()
  })
})

describe('sunucuyu sessize alma (bildirimler)', () => {
  it('sessizde değilse "Sunucuyu sessize al", sessizdeyse "Sessizden çıkar"; seçilince onToggleMute çalışır', () => {
    const onToggleMute = vi.fn()
    openServerMenu({ opener: dugmeKur(), sunucu: { name: 'S' }, sahip: false, sessiz: false, tik: { onToggleMute } })
    const sessizeAl = ogeler().find((b) => b.textContent === 'Sunucuyu sessize al')
    expect(sessizeAl.classList.contains('danger')).toBe(false)
    sessizeAl.click()
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.popup-menu')).toBeNull()
    openServerMenu({ opener: dugmeKur(), sunucu: { name: 'S' }, sahip: true, sessiz: true, tik: { onToggleMute } })
    expect(ogeler().map((b) => b.textContent)).toEqual(['Davet et', 'Sessizden çıkar', 'Sunucu ayarları', 'Kanal ekle', 'Sunucuyu sil'])
    ogeler()[1].click()
    expect(onToggleMute).toHaveBeenCalledTimes(2)
  })
})
