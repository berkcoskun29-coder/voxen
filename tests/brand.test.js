// @vitest-environment jsdom
// Logo ve vurgu rengi: yeşil "Origami V" logosu ve ona uyan yeşil vurgu
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../src/auth/auth.js', () => ({ signIn: vi.fn(), signUp: vi.fn() }))
const { renderAuthView } = await import('../src/auth/authView.js')

const oku = (yol) => readFileSync(join(process.cwd(), yol), 'utf8')

describe('marka', () => {
  it('vurgu rengi yeşil, üstündeki yazı koyu; eski mavi kalmadı', () => {
    const css = oku('src/styles/theme.css')
    expect(css).toMatch(/--accent:\s*#3be37a/)
    expect(css).toMatch(/--accent-strong:\s*#1fa35a/)
    expect(css).toMatch(/--on-accent:\s*#0f1a14/)
    expect(css).not.toMatch(/#5b7cfa/i)
    // durum renkleri ve konuşma halkası aynı kaldı
    expect(css).toMatch(/--speaking:\s*#3be37a/)
  })

  it('favicon logodur; giriş ekranında küçük logo görünür', () => {
    expect(oku('index.html')).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(oku('public/favicon.svg')).toContain('Origami V')
    expect(oku('src-tauri/icons/source.svg')).toBe(oku('public/favicon.svg'))
    const kutu = document.createElement('div')
    renderAuthView(kutu, () => {})
    const baslik = kutu.querySelector('h1.brand')
    expect(baslik.textContent).toBe('Voxen')
    expect(baslik.querySelector('img').getAttribute('src')).toBe('/favicon.svg')
  })
})
