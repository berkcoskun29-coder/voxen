// @vitest-environment jsdom
// Tasarım 3 küçük cilalar: şifre ekranları kalıbı, mikrofon testi metinleri, tuş rozeti, CSS kuralları.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../src/lib/supabase.js', () => ({ supabase: { auth: {} } }))
vi.mock('../src/voice/pipeline.js', () => ({
  openMic: vi.fn(() => new Promise(() => {})),
  createVoicePipeline: vi.fn(),
  MIC_MESSAGES: {},
}))

import { renderAuthView, renderNewPasswordView } from '../src/auth/authView.js'
import { openMicTest } from '../src/ui/micTest.js'

const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')
const yorumsuz = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('şifre ekranları aynı kalıp (U20)', () => {
  it('Şifreni sıfırla: logo + Voxen, altında başlık, altında açıklama', () => {
    const kap = document.createElement('div')
    renderAuthView(kap, () => {}, { mod: 'unuttum' })
    expect(kap.querySelector('h1.brand').textContent).toBe('Voxen')
    expect(kap.querySelector('h1.brand img')).not.toBeNull()
    expect(kap.querySelector('.card-title').textContent).toBe('Şifreni sıfırla')
    expect(kap.querySelector('.card-title + .tagline')).not.toBeNull()
  })
  it('Yeni şifre belirle aynı sırada', () => {
    const kap = document.createElement('div')
    renderNewPasswordView(kap, {})
    expect(kap.querySelector('h1.brand').textContent).toBe('Voxen')
    expect(kap.querySelector('.card-title + .tagline')).not.toBeNull()
  })
})

describe('mikrofon testi (U23)', () => {
  it('başlık, mikrofon adı ve geri çalma notu yazar', () => {
    const t = openMicTest()
    expect(document.querySelector('.mic-title').textContent).toBe('Konuş, çubuk dolsun')
    expect(document.querySelector('.mic-name').textContent).toBe('Varsayılan mikrofon')
    expect(document.body.textContent).toContain('Kaydettiğin ses sana geri çalınır.')
    t.close()
  })
})

describe('CSS cilaları', () => {
  it('U17: hatalı kutuda odak halkası kırmızı', () => {
    expect(yorumsuz).toMatch(/\[aria-invalid="true"\]:focus-visible\s*\{\s*outline-color:\s*var\(--danger\)/)
  })
  it('U19: giriş kartı dikeyde ortalanır, çevresinde 24px boşluk', () => {
    expect(yorumsuz).toMatch(/#app:has\(> \.card\)\s*\{[^}]*min-height:\s*100vh[^}]*padding:\s*var\(--sp-6\)/)
    expect(yorumsuz).toMatch(/\.card\s*\{[^}]*margin:\s*auto/)
  })
  it('U22: pasif ana düğme tek genel kuralla gri ve not-allowed', () => {
    expect(yorumsuz).toMatch(/button:disabled:not\([^{]*\{[^}]*background:\s*var\(--selected\)[^}]*cursor:\s*not-allowed/)
  })
  it('U23: çubuk 8px', () => {
    expect(yorumsuz).toMatch(/\.level-bar\s*\{\s*height:\s*8px/)
  })
  it('U25: okunmamış stilleri tanımlı', () => {
    for (const s of ['.unread-badge', '.channel-item.unread', '.unread-count', '.server-unread-dot']) expect(yorumsuz).toContain(s)
  })
})
