// @vitest-environment jsdom
// Okunmamış rozeti (src/badge.js): tarayıcıda favicon, masaüstünde Windows görev çubuğu bindirme simgesi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sahte = vi.hoisted(() => ({ overlay: [] }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setOverlayIcon: async (img) => { sahte.overlay.push(img) } }),
}))
vi.mock('@tauri-apps/api/image', () => ({
  Image: { new: async (rgba, w, h) => ({ rgba, w, h }) },
}))

import { setUnreadBadge, kirmiziNokta, resetBadge, FAVICON, FAVICON_OKUNMAMIS } from '../src/badge.js'

const bosalt = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  resetBadge()
  sahte.overlay = []
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'
})
afterEach(() => { delete window.__TAURI_INTERNALS__ })

describe('kirmiziNokta', () => {
  it('16x16 RGBA: ortası kırmızı ve opak, köşesi saydam', () => {
    const p = kirmiziNokta(16)
    expect(p).toHaveLength(16 * 16 * 4)
    const i = (8 * 16 + 8) * 4
    expect(p[i + 3]).toBe(255)
    expect(p[i]).toBeGreaterThan(200)
    expect(p[3]).toBe(0) // sol üst köşe
  })
})

describe('setUnreadBadge (tarayıcı)', () => {
  it('okunmamış varsa noktalı favicon, yoksa normal', () => {
    const link = document.querySelector('link[rel=icon]')
    setUnreadBadge(3)
    expect(link.getAttribute('href')).toBe(FAVICON_OKUNMAMIS)
    setUnreadBadge(0)
    expect(link.getAttribute('href')).toBe(FAVICON)
  })
  it('link yoksa hata vermez', () => {
    document.head.innerHTML = ''
    expect(() => setUnreadBadge(2)).not.toThrow()
  })
})

describe('setUnreadBadge (masaüstü)', () => {
  it('bindirme simgesi yalnız durum değişince konur/kalkar', async () => {
    window.__TAURI_INTERNALS__ = {}
    setUnreadBadge(2)
    await bosalt()
    setUnreadBadge(5) // hâlâ var: yeniden konmaz
    await bosalt()
    expect(sahte.overlay).toHaveLength(1)
    expect(sahte.overlay[0]).toMatchObject({ w: 16, h: 16 })
    setUnreadBadge(0)
    await bosalt()
    expect(sahte.overlay).toEqual([sahte.overlay[0], undefined])
  })
})
