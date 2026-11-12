// @vitest-environment jsdom
// Bildirim (toast) testleri: türler, eski tek parametreli çağrı, güvenli metin.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toast } from '../src/ui/layout.js'

beforeEach(() => { document.body.innerHTML = '' })

describe('toast', () => {
  it('tek parametreyle çağrılınca bilgi türündedir (eski çağrılar bozulmaz)', () => {
    toast('Merhaba')
    const el = document.querySelector('.toast')
    expect(el.textContent).toBe('Merhaba')
    expect(el.classList.contains('toast-bilgi')).toBe(true)
    expect(el.getAttribute('role')).toBe('status')
  })

  it('başarı türü toast-basari sınıfını alır', () => {
    toast('Kopyalandı', 'basari')
    const el = document.querySelector('.toast')
    expect(el.classList.contains('toast-basari')).toBe(true)
    expect(el.classList.contains('toast-bilgi')).toBe(false)
  })

  it('hata türü toast-hata sınıfını alır ve role=alert olur', () => {
    toast('Olmadı', 'hata')
    const el = document.querySelector('.toast')
    expect(el.classList.contains('toast-hata')).toBe(true)
    expect(el.getAttribute('role')).toBe('alert')
  })

  it('bilinmeyen tür bilgiye düşer', () => {
    toast('x', 'garip')
    expect(document.querySelector('.toast').classList.contains('toast-bilgi')).toBe(true)
  })

  it('metin textContent ile yazılır, HTML çalışmaz', () => {
    toast('<img src=x onerror=alert(1)>', 'hata')
    const el = document.querySelector('.toast')
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(el.querySelector('img')).toBeNull()
  })

  it('art arda bildirimler tek kutuda üst üste dizilir, önce en eskisi gider', () => {
    vi.useFakeTimers()
    try {
      toast('bir')
      vi.advanceTimersByTime(1000)
      toast('iki', 'hata')
      const kutular = document.querySelectorAll('.toast-stack')
      expect(kutular.length).toBe(1) // tek sabit kutu
      const kutu = kutular[0]
      expect([...kutu.children].map((e) => e.textContent)).toEqual(['bir', 'iki'])
      vi.advanceTimersByTime(3000) // ilki 4 sn doldu
      expect([...kutu.children].map((e) => e.textContent)).toEqual(['iki'])
      vi.advanceTimersByTime(1000) // 'iki' hata: 6 sn kalır, henüz yerinde
      expect(kutu.children.length).toBe(1)
      vi.advanceTimersByTime(2000) // 1 sn'de eklendi, 6 sn dolunca 7. sn'de gider
      expect(kutu.children.length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kutu sayfadan silinmişse (sayfa yeniden kuruldu) yenisi kurulur', () => {
    toast('a')
    document.body.innerHTML = ''
    toast('b')
    expect(document.querySelector('.toast-stack .toast').textContent).toBe('b')
  })

  it('en fazla 4 bildirim görünür, en eskisi düşer', () => {
    for (const m of ['1', '2', '3', '4', '5', '6']) toast(m)
    const kutu = document.querySelector('.toast-stack')
    expect([...kutu.children].map((e) => e.textContent)).toEqual(['3', '4', '5', '6'])
  })

  it('M7: fazlalıkta hata olmayan en eski bildirim düşer, hata korunur', () => {
    toast('hata!', 'hata')
    for (const m of ['1', '2', '3', '4', '5']) toast(m)
    const kutu = document.querySelector('.toast-stack')
    expect([...kutu.children].map((e) => e.textContent)).toEqual(['hata!', '3', '4', '5'])
  })

  it('kutuda aria-live=polite var', () => {
    toast('a')
    expect(document.querySelector('.toast-stack').getAttribute('aria-live')).toBe('polite')
  })

  it('U02: hata bildirimi × düğmesi alır (aria-label), textContent yalnız mesaj kalır', () => {
    toast('Olmadı', 'hata')
    const el = document.querySelector('.toast')
    const d = el.querySelector('button.toast-kapat')
    expect(d.getAttribute('aria-label')).toBe('Bildirimi kapat')
    expect(d.tagName).toBe('BUTTON')
    expect(el.textContent).toBe('Olmadı')
    d.click()
    expect(document.querySelector('.toast')).toBeNull()
  })

  it('U02: diğer bildirimlerde × düğmesi yok', () => {
    toast('a'); toast('b', 'basari')
    expect(document.querySelector('.toast-kapat')).toBeNull()
  })

  it('U02: hata 6 sn, diğerleri 4 sn kalır', () => {
    vi.useFakeTimers()
    try {
      toast('bilgi'); toast('hata', 'hata')
      vi.advanceTimersByTime(4000)
      expect([...document.querySelectorAll('.toast')].map((e) => e.textContent)).toEqual(['hata'])
      vi.advanceTimersByTime(1999)
      expect(document.querySelectorAll('.toast').length).toBe(1)
      vi.advanceTimersByTime(1)
      expect(document.querySelectorAll('.toast').length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('U02: bildirim genişliği CSS’te 320px / dar ekranda 100vw-32px', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/styles/theme.css', 'utf8')
    expect(css).toMatch(/\.toast \{[^}]*width: min\(320px, calc\(100vw - 32px\)\)/)
  })
})
