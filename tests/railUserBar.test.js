// @vitest-environment jsdom
// Sunucu şeridi, kullanıcı çubuğu, ses paneli ve baloncuk (tasarım turu 1, Görev 3)
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { renderRail } from '../src/ui/serverRail.js'
import { renderChannelList } from '../src/ui/channelList.js'
import { renderVoicePanel, renderMuteButtons } from '../src/ui/voicePanel.js'
import { installTooltips } from '../src/ui/tooltip.js'

const sunucular = [{ id: 's1', name: 'Tasarım' }, { id: 's2', name: 'Kampüs' }]
const railCiz = () => {
  const rail = document.createElement('nav')
  document.body.appendChild(rail)
  renderRail(rail, sunucular, 's1', {})
  return rail
}
const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, listenOnly: false, camera: false, screen: false, ...ek })
// Ses paneli + (artık kullanıcı çubuğunda duran) Sustur / Sağırlaştır düğmeleri bir arada
const panel = (state) => {
  const k = document.createElement('div')
  k.append(renderVoicePanel({ channelName: 'Lobi', state, handlers: {} }), ...renderMuteButtons(state))
  return k
}
const ad = (p, a) => [...p.querySelectorAll('button')].find((b) => b.dataset.ad === a)

describe('sunucu şeridi', () => {
  it('yalnız seçili sunucu .selected; her öğenin adı etiket ve baloncuk olarak var', () => {
    const rail = railCiz()
    expect(rail.querySelectorAll('.selected')).toHaveLength(1)
    expect(rail.querySelector('.server-icon.selected').getAttribute('aria-label')).toBe('Tasarım')
    expect(rail.querySelector('.add').dataset.tip).toBe('Sunucu oluştur')
    expect(rail.querySelector('.join').dataset.tip).toBe('Sunucuya katıl')
  })
  it('sunucularla eylemler arasında ayraç; + ve katıl SVG simge (emoji yok)', () => {
    const rail = railCiz()
    const cocuklar = [...rail.children]
    const i = cocuklar.findIndex((c) => c.classList.contains('rail-separator'))
    expect(i).toBe(2)
    expect(rail.querySelector('.add svg')).not.toBeNull()
    expect(rail.querySelector('.join svg')).not.toBeNull()
    expect(rail.querySelector('.join').textContent).toBe('')
  })
})

describe('kullanıcı çubuğu', () => {
  it('SVG simgeli Sustur, Sağırlaştır ve ayarlar var; mikrofon testi ve Çıkış yok', () => {
    const el = document.createElement('aside')
    renderChannelList(el, { server: { id: 's', name: 'S', owner_id: 'u1' }, channels: [], profile: { id: 'u1', username: 'berk', color: '#5b7cfa' }, selectedChannelId: null, handlers: {} })
    const bar = el.querySelector('.user-bar')
    expect(bar.querySelector('button[title="Mikrofon testi"]')).toBeNull() // Ayarlar > Cihazlar'da
    expect(bar.querySelector('button[data-ad="Sustur"] svg')).not.toBeNull()
    expect(bar.querySelector('button[data-ad="Sağırlaştır"] svg')).not.toBeNull()
    expect(bar.querySelector('button[title="Ayarlar"] svg')).not.toBeNull()
    expect(bar.querySelector('button[aria-label="Ayarlar"]')).not.toBeNull()
    expect(bar.querySelector('button[title="Ayarlar"]').dataset.tip).toBe('Ayarlar')
    expect(bar.textContent).not.toContain('Çıkış')
    expect(bar.querySelector('button[title="Çıkış"]')).toBeNull()
  })
})

describe('ses paneli', () => {
  it('üst satır "Ses bağlandı · Lobi", Ayrıl kare kırmızı düğme (aria-label "Ayrıl")', () => {
    const p = panel(durum())
    expect(p.querySelector('.voice-top .voice-info').textContent).toBe('Ses bağlandı · Lobi')
    const ayril = p.querySelector('.voice-top button.leave')
    expect(ayril.getAttribute('aria-label')).toBe('Ayrıl')
    expect(ayril.querySelector('svg')).not.toBeNull()
  })
  it('bağlanırken durum yazısı korunur; kamera ve ekran düğmeleri pasif', () => {
    const p = panel(durum({ status: 'connecting' }))
    expect(p.querySelector('.voice-status').textContent).toBe('Bağlanıyor…')
    for (const k of ['Kamera', 'Ekran']) {
      const b = ad(p, k)
      if (!b) continue // ekran düğmesi tarayıcı desteğine bağlı
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(b.disabled).toBe(false) // odaklanabilir, baloncuk görünür
      expect(b.dataset.tip).toBeTruthy()
    }
    let tik = 0
    const q = renderVoicePanel({ channelName: 'Lobi', state: durum({ status: 'connecting' }), handlers: { onToggleCamera: () => tik++ } })
    ad(q, 'Kamera').click()
    expect(tik).toBe(0)
  })
  it('pasif düğmenin baloncuğu nedenini söyler', () => {
    const p = panel(durum({ status: 'connecting' }))
    for (const k of ['Kamera', 'Ekran']) {
      const b = ad(p, k)
      if (!b || !b.classList.contains('unavailable') || b.dataset.tip === undefined) continue
      if (k === 'Ekran' && !b.dataset.pasif) continue // masaüstü uyarısı kendi metnini taşır
      expect(b.dataset.tip).toBe('Bağlanırken kullanılamaz')
      expect(b.getAttribute('aria-label')).toBeTruthy() // ad ekran okuyucuda kalır
    }
    const yalnizDinle = panel(durum({ listenOnly: true }))
    expect(ad(yalnizDinle, 'Sustur').dataset.tip).toBe('Mikrofon yok')
    expect(ad(yalnizDinle, 'Sustur').getAttribute('aria-disabled')).toBe('true')
    // Pasif değilken her zamanki adı
    expect(ad(panel(durum()), 'Kamera').dataset.tip).toBe('Kamerayı aç')
  })
  it('düğmeler yalnız simge; adları aria-label ve baloncuk metninde', () => {
    const p = panel(durum())
    for (const [k, etiket] of [['Sustur', 'Mikrofonu kapat'], ['Sağırlaştır', 'Sesi kapat'], ['Kamera', 'Kamerayı aç']]) {
      const b = ad(p, k)
      expect(b.textContent).toBe('')
      // Sustur/Sağırlaştır'ın adı sabit (durumu aria-pressed söyler); değişen yazı baloncukta
      expect(b.getAttribute('aria-label')).toBe(k === 'Kamera' ? etiket : k)
      expect(b.dataset.tip).toBe(etiket)
    }
  })
  it('basılı durum: mute/deafen .active + çizili simge; kamera açıkken .active', () => {
    const p = panel(durum({ muted: true, deafened: true, camera: true }))
    expect(ad(p, 'Sustur').classList.contains('active')).toBe(true)
    expect(ad(p, 'Sustur').querySelector('svg.crossed')).not.toBeNull()
    expect(ad(p, 'Sağırlaştır').querySelector('svg.crossed')).not.toBeNull()
    expect(ad(p, 'Kamera').classList.contains('active')).toBe(true)
    expect(ad(p, 'Kamera').getAttribute('aria-label')).toBe('Kamerayı kapat')
  })
})

describe('Aramada satırı', () => {
  const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
  const cizim = (call) => {
    const el = document.createElement('aside')
    renderChannelList(el, { server: { id: 's', name: 'S', owner_id: 'u1' }, channels: [], profile: profil, selectedChannelId: null, handlers: {}, call })
    return el
  }
  it('"Aramada · Ad" yazar; tıklayınca onOpen, Kapat düğmesi onHangup çağrılır', () => {
    let ac = 0, kapat = 0
    const el = cizim({ peerName: 'ayla', handlers: { onOpen: () => ac++, onHangup: () => kapat++ } })
    const satir = el.querySelector('.call-row')
    expect(satir.querySelector('.voice-info').textContent).toBe('Aramada · ayla')
    satir.querySelector('.voice-info').click()
    expect(ac).toBe(1)
    const k = satir.querySelector('button.leave')
    expect(k.getAttribute('aria-label')).toBe('Kapat')
    k.click()
    expect(kapat).toBe(1)
    // Kullanıcı çubuğunun hemen üstünde durur
    expect(satir.nextElementSibling.classList.contains('user-bar')).toBe(true)
  })
  it('kamera/ekran açıkken satırda yeşil kapatma düğmeleri çıkar; kapalıyken yok', () => {
    expect(cizim({ peerName: 'ayla', handlers: {} }).querySelector('.call-row .camera-btn')).toBeNull()
    let kam = 0, ekr = 0
    const el = cizim({ peerName: 'ayla', video: { camera: true, screen: true }, handlers: { onToggleCamera: () => kam++, onToggleScreen: () => ekr++ } })
    const kamera = el.querySelector('.call-row [data-ad="Kamera"]')
    const ekran = el.querySelector('.call-row [data-ad="Ekran"]')
    expect(kamera.getAttribute('aria-label')).toBe('Kamerayı kapat')
    expect(ekran.getAttribute('aria-label')).toBe('Paylaşımı durdur')
    expect(kamera.classList.contains('active')).toBe(true)
    kamera.click(); ekran.click()
    expect([kam, ekr]).toEqual([1, 1])
  })
  it('ad textContent ile yazılır; arama yoksa satır da yok', () => {
    expect(cizim({ peerName: '<i>x</i>', handlers: {} }).querySelector('.call-row i')).toBeNull()
    expect(cizim(null).querySelector('.call-row')).toBeNull()
  })
  it('sesli kanal paneli varsa o gösterilir, arama satırı çıkmaz', () => {
    const el = document.createElement('aside')
    renderChannelList(el, { server: { id: 's', name: 'S', owner_id: 'u1' }, channels: [], profile: profil, selectedChannelId: null, handlers: {},
      voice: { channelName: 'Lobi', state: durum(), handlers: {} }, call: { peerName: 'ayla', handlers: {} } })
    expect(el.querySelector('.call-row')).toBeNull()
    expect(el.querySelector('.voice-panel')).not.toBeNull()
  })
})

describe('baloncuk', () => {
  beforeAll(() => installTooltips())
  const balon = () => document.querySelector('.tooltip')
  it('üstüne gelince data-tip metnini gösterir, çıkınca gizler ve title geri gelir', () => {
    const rail = railCiz()
    const b = rail.querySelector('.add')
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(balon().hidden).toBe(false)
    expect(balon().textContent).toBe('Sunucu oluştur')
    expect(b.hasAttribute('title')).toBe(false) // sistem baloncuğu ikilenmesin
    b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    expect(balon().hidden).toBe(true)
    expect(b.title).toBe('Sunucu oluştur')
  })
  it('klavye odağında da görünür', () => {
    const p = panel(durum())
    document.body.appendChild(p)
    ad(p, 'Sağırlaştır').focus() // jsdom'da odaklanan öğe :focus-visible sayılır
    expect(balon().hidden).toBe(false)
    expect(balon().textContent).toBe('Sesi kapat')
    ad(p, 'Sağırlaştır').blur()
    expect(balon().hidden).toBe(true)
  })
  it('fareyle tıklayınca gelen odakta (:focus-visible değil) baloncuk açılmaz', () => {
    const p = panel(durum())
    document.body.appendChild(p)
    const b = ad(p, 'Sağırlaştır')
    // Tarayıcı fare odağında :focus-visible demez; jsdom bunu ayırt etmediği için taklit ederiz
    const asil = b.matches.bind(b)
    b.matches = (s) => (s === ':focus-visible' ? false : asil(s))
    b.focus()
    expect(balon().hidden).toBe(true)
    b.blur()
  })
  it(':focus-visible desteklenmiyorsa (seçici hata verir) klavye odağında yine görünür', () => {
    const p = panel(durum())
    document.body.appendChild(p)
    const b = ad(p, 'Sağırlaştır')
    const asil = b.matches.bind(b)
    b.matches = (s) => { if (s === ':focus-visible') throw new SyntaxError('desteklenmiyor'); return asil(s) }
    b.focus()
    expect(balon().hidden).toBe(false)
    b.blur()
  })
  it('öğe DOM dışına çıkarsa (yeniden çizim) baloncuk takılı kalmaz', () => {
    const rail = railCiz()
    const b = rail.querySelector('.add')
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(balon().hidden).toBe(false)
    b.remove() // mouseout gelmez
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(balon().hidden).toBe(true)
  })
  it('aynı düğmenin içinde gezerken kapanmaz (relatedTarget)', () => {
    const rail = railCiz()
    const b = rail.querySelector('.add')
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: b.querySelector('svg') }))
    expect(balon().hidden).toBe(false)
  })
  it('tıklayınca yeni adıyla yeniden görünür', () => {
    vi.useFakeTimers()
    const p = panel(durum())
    document.body.appendChild(p)
    const s = ad(p, 'Sustur')
    s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    s.addEventListener('click', () => { s.dataset.tip = 'Mikrofonu aç' }) // oturum adı değiştirir
    s.click()
    expect(balon().hidden).toBe(true)
    vi.advanceTimersByTime(60)
    expect(balon().hidden).toBe(false)
    expect(balon().textContent).toBe('Mikrofonu aç')
    vi.useRealTimers()
  })
  it('açık/kapa düğmesi olmayan öğeye tıklayınca yeniden göstermez', () => {
    vi.useFakeTimers()
    const rail = railCiz()
    const b = rail.querySelector('.add')
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    b.click()
    vi.advanceTimersByTime(100)
    expect(balon().hidden).toBe(true)
    vi.useRealTimers()
  })
  it('50 ms dolmadan fare çıkarsa yeniden göstermez', () => {
    vi.useFakeTimers()
    const p = panel(durum())
    document.body.appendChild(p)
    const s = ad(p, 'Sustur')
    s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    s.click()
    s.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    vi.advanceTimersByTime(100)
    expect(balon().hidden).toBe(true)
    vi.useRealTimers()
  })
})
