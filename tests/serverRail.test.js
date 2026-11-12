// @vitest-environment jsdom
// Sunucu şeridi: okunmamış yüzünden yeniden çizilince klavye odağı kaybolmaz.
import { describe, it, expect } from 'vitest'
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
