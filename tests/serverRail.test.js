// @vitest-environment jsdom
// Sunucu şeridi: okunmamış yüzünden yeniden çizilince klavye odağı kaybolmaz.
import { describe, it, expect, vi } from 'vitest'
import { renderRail } from '../src/ui/serverRail.js'

const sunucular = [{ id: 's1', name: 'Alfa' }, { id: 's2', name: 'Beta' }]
const kolay = {}

describe('renderRail klavye odağı', () => {
  it('yeniden çizilince odaktaki sunucu düğmesi yeni düğmede odakta kalır', () => {
    const rail = document.createElement('nav')
    document.body.appendChild(rail)
    renderRail(rail, sunucular, 's1', kolay)
    const eski = [...rail.querySelectorAll('button')][1]
    eski.focus()
    expect(document.activeElement).toBe(eski)
    renderRail(rail, sunucular, 's1', kolay, { serverCount: (id) => (id === 's2' ? 3 : 0) })
    const yeni = [...rail.querySelectorAll('button')][1]
    expect(yeni).not.toBe(eski)
    expect(document.activeElement).toBe(yeni)
    expect(yeni.querySelector('.unread-badge').textContent).toBe('3')
  })

  it('"+" ve "katıl" düğmelerinde de odak korunur; odak şeritte değilse dokunulmaz', () => {
    const rail = document.createElement('nav')
    document.body.appendChild(rail)
    renderRail(rail, sunucular, 's1', kolay)
    rail.querySelector('.server-icon.join').focus()
    renderRail(rail, sunucular, 's1', kolay)
    expect(document.activeElement).toBe(rail.querySelector('.server-icon.join'))
    document.activeElement.blur()
    renderRail(rail, sunucular, 's1', kolay)
    expect(rail.contains(document.activeElement)).toBe(false)
  })
})

describe('renderRail Ana sayfa düğmesi', () => {
  it('home verilmezse çizilmez (eski çağrılar aynen)', () => {
    const rail = document.createElement('nav')
    renderRail(rail, sunucular, 's1', kolay)
    expect(rail.querySelector('.rail-home')).toBeNull()
  })

  it('en üstte Voxen logolu Ana sayfa ve altında ayraç, sonra sunucular', () => {
    const rail = document.createElement('nav')
    renderRail(rail, sunucular, 's1', kolay, null, { selected: false, unread: 0 })
    const [ev, ayrac, ilk] = rail.children
    expect(ev.classList.contains('rail-home')).toBe(true)
    expect(ev.getAttribute('aria-label')).toBe('Ana sayfa')
    expect(ev.querySelector('img').getAttribute('src')).toBe('/favicon.svg')
    expect(ayrac.classList.contains('rail-home-separator')).toBe(true)
    expect(ilk.classList.contains('server-icon')).toBe(true)
    expect(ev.querySelector('.unread-badge')).toBeNull() // okunmamış DM yoksa rozet yok
    // Sunucu simgeleri arasında sayılmaz
    expect(rail.querySelectorAll('.server-icon:not(.add):not(.join)')).toHaveLength(2)
  })

  it('okunmamış DM toplamı sağ altta kırmızı rozet; seçiliyken sunucu seçili görünmez', () => {
    const rail = document.createElement('nav')
    const onHome = vi.fn()
    renderRail(rail, sunucular, null, { onHome }, null, { selected: true, unread: 120 })
    const ev = rail.querySelector('.rail-home')
    expect(ev.classList.contains('selected')).toBe(true)
    expect(ev.querySelector('.unread-badge').textContent).toBe('99+')
    expect(ev.getAttribute('aria-label')).toBe('Ana sayfa, 99+ okunmamış mesaj')
    expect(rail.querySelectorAll('.server-icon.selected')).toHaveLength(0)
    ev.click()
    expect(onHome).toHaveBeenCalled()
  })

  it('yeniden çizimde Ana sayfa düğmesinin odağı korunur', () => {
    const rail = document.createElement('nav')
    document.body.appendChild(rail)
    renderRail(rail, sunucular, 's1', kolay, null, { selected: false, unread: 0 })
    rail.querySelector('.rail-home').focus()
    renderRail(rail, sunucular, 's1', kolay, null, { selected: false, unread: 2 })
    expect(document.activeElement).toBe(rail.querySelector('.rail-home'))
  })
})

describe('renderRail sessize alınan sunucu', () => {
  it('simge soluk (muted sınıfı) görünür, okunmamış rozeti yine çıkar; ekran okuyucu "sessizde" duyar', () => {
    const rail = document.createElement('nav')
    const unread = { serverCount: (id) => (id === 's2' ? 4 : 0), serverMentions: () => 0 }
    renderRail(rail, sunucular, 's1', kolay, unread, null, new Set(['s1', 's2']))
    const [alfa, beta] = rail.querySelectorAll('.server-icon:not(.add):not(.join)')
    expect(alfa.classList.contains('muted')).toBe(true)
    expect(alfa.getAttribute('aria-label')).toBe('Alfa, sessizde')
    expect(beta.classList.contains('muted')).toBe(true)
    expect(beta.querySelector('.unread-badge').textContent).toBe('4')
    expect(beta.getAttribute('aria-label')).toBe('Beta, 4 okunmamış mesaj, sessizde')
    renderRail(rail, sunucular, 's1', kolay, unread)
    expect(rail.querySelector('.server-icon.muted')).toBeNull() // verilmezse eski çağrılar aynen
  })
})
