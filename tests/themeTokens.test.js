// Tema: renkler yalnız :root'taki değişkenlerden gelir; ölçek dışı boylar açıklamalı istisnadır.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')
// :root bloğu (değişkenlerin tanımlandığı yer) dışındaki kurallar
const kurallar = css.replace(/:root\s*\{[^}]*\}/, '')
// Yorumları atınca kalan kod
const yorumsuz = kurallar.replace(/\/\*[\s\S]*?\*\//g, '')

describe('tema değişkenleri', () => {
  it('panel, şerit, konuşma ve link renkleri kurallarda sabit yazılmaz (değişken kullanılır)', () => {
    for (const renk of ['#1b1e24', '#0f1013', '#3be37a', '#2dd4bf', 'rgba(45, 212, 191']) {
      expect(yorumsuz.toLowerCase()).not.toContain(renk)
    }
    expect(css).toMatch(/--link:\s*#2dd4bf/)
    expect(yorumsuz).toMatch(/\.msg-link\s*\{[^}]*color:\s*var\(--link\)/)
  })

  it('22px / 34px boyları ya ölçek değişkenine çevrildi ya da satırında "istisna" açıklaması var', () => {
    for (const satir of kurallar.split('\n')) {
      if (/\b(22|34)px/.test(satir.replace(/\/\*[\s\S]*?\*\//g, ''))) expect(satir).toMatch(/istisna/i)
    }
    expect(yorumsuz).toMatch(/\.welcome-card h2\s*\{[^}]*font-size:\s*var\(--fs-xl\)/)
  })

  it('tuş penceresindeki nabız animasyonu hareket azaltma tercihinde kapanır', () => {
    expect(yorumsuz).toMatch(/\.key-listen\.dinliyor\s*\{[^}]*animation:/)
    expect(yorumsuz).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.key-listen\.dinliyor\s*\{\s*animation:\s*none/)
  })

  it('@bahsetme: etiket ve vurgu tema değişkenleriyle; etiket geçişi hareket azaltmada kapanır', () => {
    expect(css).toMatch(/--mention-line:/)
    expect(yorumsuz).toMatch(/\.mention\s*\{[^}]*background:\s*var\(--mention-tag-bg\)/)
    expect(yorumsuz).toMatch(/\.message\.mentioned\s*\{[^}]*var\(--mention-bg\)[^}]*var\(--mention-line\)/)
    expect(yorumsuz).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.mention\s*\{\s*transition:\s*none/)
  })

  it('dar pencerede ayarlar menüsü üste gelir (tek kolon)', () => {
    expect(yorumsuz).toMatch(/@media \(max-width:\s*\d+px\)\s*\{[^@]*\.settings-layout\s*\{[^}]*flex-direction:\s*column/)
  })

  it('v0.13.0 tur 1 (K3): sessiz sunucunun rozeti ve noktası soluk', () => {
    expect(yorumsuz).toMatch(/\.server-icon\.muted \.unread-badge, \.server-icon\.muted \.server-unread-dot\s*\{\s*opacity:\s*0\.5/)
  })
})
