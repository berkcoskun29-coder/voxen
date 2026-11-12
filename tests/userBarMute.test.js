// @vitest-environment jsdom
// Tasarım turu 2, Görev 2: kullanıcı çubuğunda Sustur / Sağırlaştır (U01), sunucusuz düzen (U12),
// pencerede Shift+Tab ve tuş penceresi ipucu.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderChannelList } from '../src/ui/channelList.js'
import { renderVoicePanel } from '../src/ui/voicePanel.js'
import { renderRail } from '../src/ui/serverRail.js'
import { getSettings, updateSettings } from '../src/settings.js'
import { createModalShell } from '../src/ui/modal.js'
import { askPttKey } from '../src/ui/settings.js'

const profil = { id: 'u1', username: 'berk', color: '#5b7cfa' }
const sunucu = { id: 's', name: 'S', owner_id: 'u1' }
const durum = (ek = {}) => ({ status: 'connected', muted: false, deafened: false, listenOnly: false, camera: false, screen: false, speaking: new Set(), ...ek })

function cubuk(ek = {}) {
  const panel = document.createElement('aside')
  document.body.appendChild(panel)
  renderChannelList(panel, { server: sunucu, channels: [], profile: profil, selectedChannelId: null, handlers: {}, ...ek })
  return panel.querySelector('.user-bar')
}
const dugme = (kok, ad) => [...kok.querySelectorAll('button')].find((b) => b.dataset.ad === ad)

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('kullanıcı çubuğunda Sustur / Sağırlaştır (U01)', () => {
  it('sesli kanalda değilken de iki simge düğmesi var; mikrofon testi yok', () => {
    const bar = cubuk({ audio: { muted: false, deafened: false } })
    const s = dugme(bar, 'Sustur')
    const d = dugme(bar, 'Sağırlaştır')
    expect(s.dataset.tip).toBe('Mikrofonu kapat')
    expect(s.dataset.tip).toBe('Mikrofonu kapat')
    expect(s.dataset.odak).toBe('ses-Sustur')
    expect(s.getAttribute('aria-pressed')).toBe('false')
    expect(s.textContent).toBe('')
    expect(d.dataset.tip).toBe('Sesi kapat')
    expect(bar.querySelector('[aria-label="Mikrofon testi"]')).toBeNull()
    expect(bar.querySelector('[aria-label="Ayarlar"]')).not.toBeNull()
  })

  it('basılıyken kırmızı (active) ve çizili simge; etiket "Mikrofonu aç" / "Sesi aç"', () => {
    const bar = cubuk({ audio: { muted: true, deafened: true } })
    const s = dugme(bar, 'Sustur')
    expect(s.classList.contains('active')).toBe(true)
    expect(s.getAttribute('aria-pressed')).toBe('true')
    expect(s.querySelector('svg.crossed')).not.toBeNull()
    expect(s.dataset.tip).toBe('Mikrofonu aç')
    expect(dugme(bar, 'Sağırlaştır').dataset.tip).toBe('Sesi aç')
  })

  it('tıklayınca işleyiciler çağrılır', () => {
    const tik = []
    const bar = cubuk({ audio: { muted: false, deafened: false }, handlers: { onToggleMute: () => tik.push('m'), onToggleDeafen: () => tik.push('d') } })
    dugme(bar, 'Sustur').click()
    dugme(bar, 'Sağırlaştır').click()
    expect(tik).toEqual(['m', 'd'])
  })

  it('sesli kanaldayken oturumun durumunu gösterir (tercihi değil)', () => {
    const voice = { channelName: 'Lobi', state: durum({ muted: true }), handlers: {} }
    const bar = cubuk({ audio: { muted: false, deafened: false }, voice })
    expect(dugme(bar, 'Sustur').getAttribute('aria-pressed')).toBe('true')
  })

  it('mikrofon yoksa Sustur pasif: "Mikrofon yok", tıklama boşa gider', () => {
    let tik = 0
    const voice = { channelName: 'Lobi', state: durum({ listenOnly: true, muted: true }), handlers: {} }
    const bar = cubuk({ voice, handlers: { onToggleMute: () => tik++ } })
    const s = dugme(bar, 'Sustur')
    expect(s.getAttribute('aria-disabled')).toBe('true')
    expect(s.dataset.tip).toBe('Mikrofon yok')
    s.click()
    expect(tik).toBe(0)
  })

  it('adın yanında ikinci (çizili) simge yok', () => {
    const voice = { channelName: 'Lobi', state: durum({ muted: true }), handlers: {} }
    const bar = cubuk({ voice })
    expect(bar.querySelectorAll('svg[data-state]')).toHaveLength(0)
  })

  it('ses panelinde Sustur / Sağırlaştır yok; kamera ve Ayrıl kalır', () => {
    const p = renderVoicePanel({ channelName: 'Lobi', state: durum(), handlers: {} })
    expect(dugme(p, 'Sustur')).toBeUndefined()
    expect(dugme(p, 'Sağırlaştır')).toBeUndefined()
    expect(dugme(p, 'Kamera')).toBeDefined()
    expect(dugme(p, 'Ayrıl')).toBeDefined()
  })
})

describe('susturma tercihi (ayarlar)', () => {
  it('varsayılan kapalı; kaydedilir ve bozuk değer düzeltilir', () => {
    expect(getSettings().muted).toBe(false)
    expect(getSettings().deafened).toBe(false)
    updateSettings({ muted: true, deafened: true })
    expect(getSettings()).toMatchObject({ muted: true, deafened: true })
    updateSettings({ muted: 'evet', deafened: 1 })
    expect(getSettings()).toMatchObject({ muted: false, deafened: false })
  })
})

describe('sunucusuz düzen (U12)', () => {
  it('sunucu yokken kanal panelinde yinelenen yazı yok', () => {
    const panel = document.createElement('aside')
    renderChannelList(panel, { server: undefined, channels: [], profile: profil, handlers: {} })
    expect(panel.textContent).not.toContain('Henüz sunucun yok')
    expect(panel.querySelector('.user-bar')).not.toBeNull()
  })

  it('sunucu yokken şeritte tek başına ayraç yok; sunucu varken var', () => {
    const rail = document.createElement('nav')
    renderRail(rail, [], null, {})
    expect(rail.querySelector('.rail-separator')).toBeNull()
    expect(rail.querySelector('.add')).not.toBeNull()
    renderRail(rail, [{ id: 's', name: 'S' }], 's', {})
    expect(rail.querySelector('.rail-separator')).not.toBeNull()
  })
})

describe('pencere: başlıktan Shift+Tab', () => {
  it('odak başlıktayken Shift+Tab son öğeye döner (pencereden kaçmaz)', () => {
    createModalShell({ baslik: 'Ayarlar', govde: [document.createElement('input')], birincil: { yazi: 'Tamam', tik: () => null }, odakBasliga: true })
    expect(document.activeElement.tagName).toBe('H2')
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement.textContent).toBe('Tamam')
  })
})

describe('tuş penceresi ipucu', () => {
  it("Enter'ın ilk tuş olarak seçilebildiğini söyler", () => {
    askPttKey(null)
    expect(document.body.textContent).toContain("Enter'ı seçmek istiyorsan ilk tuş olarak Enter'a bas.")
    document.querySelector('.modal-x').click()
  })
})
