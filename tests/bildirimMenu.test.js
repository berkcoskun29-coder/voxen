// @vitest-environment jsdom
// Bildirim menüleri (v0.13.0): sunucu menüsündeki düzey seçenekleri ve "Tümünü okundu say",
// kanal bildirim menüsü (düzey + süreli sessize alma), DM "Konuşmayı sessize al".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openServerMenu, openChannelNotifyMenu, openDmNotifyMenu, closeMenu } from '../src/ui/serverMenu.js'

beforeEach(() => {
  closeMenu()
  document.body.innerHTML = ''
})

function dugme() {
  const d = document.createElement('button')
  d.dataset.odak = 'x'
  document.body.appendChild(d)
  d.focus()
  return d
}
const ogeler = () => [...document.querySelectorAll('.popup-menu button')]
const yazilar = () => ogeler().map((b) => b.textContent)
const bul = (yazi) => ogeler().find((b) => b.textContent === yazi)

describe('sunucu menüsü: bildirim ayarları', () => {
  it('üç düzey (menuitemradio, seçili aria-checked) ve "Tümünü okundu say"', () => {
    const tik = { onLevel: vi.fn(), onMarkRead: vi.fn() }
    openServerMenu({ opener: dugme(), sunucu: { name: 'S' }, sahip: false, duzey: 'all', tik })
    expect(yazilar()).toEqual(expect.arrayContaining(['Tümünü okundu say', 'Tüm mesajlar', 'Yalnız @bahsetmeler', 'Hiçbiri', 'Sunucuyu sessize al']))
    expect(document.querySelector('.popup-menu .popup-heading').textContent).toBe('Bildirim ayarları')
    const radyolar = [...document.querySelectorAll('.popup-menu [role=menuitemradio]')]
    expect(radyolar.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Tüm mesajlar', 'true'], ['Yalnız @bahsetmeler', 'false'], ['Hiçbiri', 'false'],
    ])
    bul('Hiçbiri').click()
    expect(tik.onLevel).toHaveBeenCalledWith('none')
    expect(document.querySelector('.popup-menu')).toBeNull()
  })

  it('düzey verilmezse varsayılan seçili; Tümünü okundu say çağrılır', () => {
    const tik = { onLevel: vi.fn(), onMarkRead: vi.fn() }
    openServerMenu({ opener: dugme(), sunucu: { name: 'S' }, sahip: false, tik })
    expect(bul('Yalnız @bahsetmeler').getAttribute('aria-checked')).toBe('true')
    bul('Tümünü okundu say').click()
    expect(tik.onMarkRead).toHaveBeenCalled()
  })

  it('ok tuşları yalnız düğmeler arasında gezer (başlık atlanır)', () => {
    openServerMenu({ opener: dugme(), sunucu: { name: 'S' }, sahip: false, tik: { onLevel: vi.fn(), onMarkRead: vi.fn() } })
    const liste = ogeler()
    expect(document.activeElement).toBe(liste[0])
    for (let i = 1; i < liste.length; i++) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(document.activeElement).toBe(liste[i])
    }
  })
})

describe('kanal bildirim menüsü', () => {
  it('sunucu varsayılanı + üç düzey; seçili olan işaretli; sessize alma süreleri', () => {
    const tik = { onLevel: vi.fn(), onMute: vi.fn(), onUnmute: vi.fn() }
    openChannelNotifyMenu({ opener: dugme(), kanal: { name: 'genel' }, duzey: null, sunucuDuzeyi: 'all', sessiz: false, tik })
    expect(document.querySelector('.popup-menu').getAttribute('aria-label')).toBe('genel bildirim ayarları')
    expect(yazilar()).toEqual([
      'Sunucu varsayılanı (Tüm mesajlar)', 'Tüm mesajlar', 'Yalnız @bahsetmeler', 'Hiçbiri',
      '1 saat', '8 saat', '24 saat', 'Ben açana kadar',
    ])
    expect(bul('Sunucu varsayılanı (Tüm mesajlar)').getAttribute('aria-checked')).toBe('true')
    expect(bul('Tüm mesajlar').getAttribute('aria-checked')).toBe('false')
    expect([...document.querySelectorAll('.popup-heading')].map((h) => h.textContent)).toEqual(['Bildirim ayarları', 'Kanalı sessize al'])
    bul('8 saat').click()
    expect(tik.onMute).toHaveBeenCalledWith(8)
  })

  it('düzey seçimi; sunucu varsayılanı null ile', () => {
    const tik = { onLevel: vi.fn(), onMute: vi.fn(), onUnmute: vi.fn() }
    openChannelNotifyMenu({ opener: dugme(), kanal: { name: 'genel' }, duzey: 'none', sessiz: false, tik })
    expect(bul('Hiçbiri').getAttribute('aria-checked')).toBe('true')
    bul('Sunucu varsayılanı (Yalnız @bahsetmeler)').click()
    expect(tik.onLevel).toHaveBeenCalledWith(null)
    openChannelNotifyMenu({ opener: dugme(), kanal: { name: 'genel' }, duzey: null, sessiz: false, tik })
    bul('Ben açana kadar').click()
    expect(tik.onMute).toHaveBeenCalledWith(null)
  })

  it('sessizse: süreler yerine "Sessizden çıkar" ve bitiş bilgisi', () => {
    const tik = { onLevel: vi.fn(), onMute: vi.fn(), onUnmute: vi.fn() }
    openChannelNotifyMenu({ opener: dugme(), kanal: { name: 'genel' }, duzey: null, sessiz: true, sessizBitis: null, tik })
    expect(yazilar()).not.toContain('1 saat')
    expect([...document.querySelectorAll('.popup-heading')].map((h) => h.textContent)).toContain('Sessizde: ben açana kadar')
    bul('Sessizden çıkar').click()
    expect(tik.onUnmute).toHaveBeenCalled()
  })
})

describe('DM bildirim menüsü', () => {
  it('Konuşmayı sessize al / Sessizden çıkar', () => {
    const onToggle = vi.fn()
    openDmNotifyMenu({ opener: dugme(), ad: 'ayla', sessiz: false, onToggle })
    expect(yazilar()).toEqual(['Konuşmayı sessize al'])
    expect(document.querySelector('.popup-menu').getAttribute('aria-label')).toBe('ayla bildirim ayarları')
    bul('Konuşmayı sessize al').click()
    expect(onToggle).toHaveBeenCalled()
    openDmNotifyMenu({ opener: dugme(), ad: 'ayla', sessiz: true, onToggle })
    expect(yazilar()).toEqual(['Sessizden çıkar'])
  })
})
