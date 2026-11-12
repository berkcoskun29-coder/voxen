// @vitest-environment jsdom
// Mesajdaki linkler (T09): yalnız http/https tıklanır olur; geri kalan her şey düz metin kalır.
import { describe, it, expect } from 'vitest'
import { linkParcalari, linkliMetin } from '../src/ui/links.js'

// Parçaları kısa bir dizgiye çevirir: link -> [link], metin -> olduğu gibi
const ozet = (metin) => linkParcalari(metin).map((p) => (p.link ? `[${p.metin}]` : p.metin)).join('')

describe('linkParcalari', () => {
  it('düz metinde link yok', () => {
    expect(linkParcalari('merhaba dünya')).toEqual([{ link: false, metin: 'merhaba dünya' }])
  })
  it('karışık metindeki http ve https adreslerini ayırır', () => {
    expect(ozet('bak https://a.com/x?y=1 ve http://b.org')).toBe('bak [https://a.com/x?y=1] ve [http://b.org]')
  })
  it('sondaki noktalama işaretleri linke dahil değil', () => {
    expect(ozet('şuna bak https://a.com.')).toBe('şuna bak [https://a.com].')
    expect(ozet('https://a.com/x, sonra')).toBe('[https://a.com/x], sonra')
    expect(ozet('gördün mü https://a.com?!')).toBe('gördün mü [https://a.com]?!')
    expect(ozet('"https://a.com";')).toBe('"[https://a.com]";')
    expect(ozet('https://a.com:')).toBe('[https://a.com]:')
  })
  it('kapanış parantezi yalnız açılışı yoksa dışarıda kalır', () => {
    expect(ozet('(bkz. https://a.com).')).toBe('(bkz. [https://a.com]).')
    expect(ozet('https://tr.wikipedia.org/wiki/Ankara_(il)')).toBe('[https://tr.wikipedia.org/wiki/Ankara_(il)]')
    expect(ozet('(https://tr.wikipedia.org/wiki/Ankara_(il))')).toBe('([https://tr.wikipedia.org/wiki/Ankara_(il)])')
  })
  it('< ve > linke dahil değil', () => {
    expect(ozet('https://a.com/<b>')).toBe('[https://a.com/]<b>')
  })
  it('javascript:, data:, vbscript: ve // ile başlayanlar düz metin', () => {
    for (const m of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)', '//evil.com/x', 'ftp://a.com']) {
      expect(linkParcalari(m).every((p) => !p.link)).toBe(true)
    }
  })
  it('adı yarım kalan adres (https:// tek başına) link olmaz', () => {
    expect(linkParcalari('https://').every((p) => !p.link)).toBe(true)
    expect(linkParcalari('https://.').every((p) => !p.link)).toBe(true)
  })
  it('kelimenin ortasında başlayan adres link olmaz', () => {
    expect(linkParcalari('xhttps://a.com').every((p) => !p.link)).toBe(true)
  })
  it("Türkçe ek (https://a.com'a) linke girmez", () => {
    expect(ozet("https://a.com'a gir")).toBe("[https://a.com]'a gir")
  })
  it('kıvrık tırnak ve « » adrese girmez (telefon klavyeleri)', () => {
    expect(ozet('“https://a.com”')).toBe('“[https://a.com]”')
    expect(ozet('«https://a.com/x»')).toBe('«[https://a.com/x]»')
    expect(ozet('‘https://a.com’')).toBe('‘[https://a.com]’')
    expect(linkParcalari('“https://a.com”').find((p) => p.link).href).toBe('https://a.com/')
    expect(linkParcalari('«https://a.com/x»').find((p) => p.link).href).toBe('https://a.com/x')
  })
  it('köşeli ve süslü parantez de açılışı yoksa dışarıda kalır', () => {
    expect(ozet('[https://a.com]')).toBe('[[https://a.com]]')
    expect(ozet('https://a.com/x]')).toBe('[https://a.com/x]]')
    expect(ozet('{https://a.com}')).toBe('{[https://a.com]}')
    expect(ozet('https://a.com/[1]')).toBe('[https://a.com/[1]]')
  })
  it('Türkçe harften sonra başlayan adres (çhttps://...) link olmaz', () => {
    expect(linkParcalari('çhttps://a.com').every((p) => !p.link)).toBe(true)
    expect(linkParcalari('İhttps://a.com').every((p) => !p.link)).toBe(true)
  })
  it('görünen yazı, linkin gittiği adresle aynı (gizli ek yok)', () => {
    const girdiler = ['“https://a.com”', '«https://a.com/x»', '‘https://a.com’', '(bkz. https://a.com/y).',
      '[https://a.com/z]', 'https://a.com/x?q=1&r=2#k!', '"https://a.com/"><img>']
    for (const g of girdiler) {
      for (const p of linkParcalari(g).filter((p) => p.link)) {
        // Tarayıcı yalnız sona "/" ekleyebilir; başka hiçbir fark olmamalı
        expect([p.metin, p.metin + '/']).toContain(p.href)
      }
    }
  })
})

describe('linkliMetin', () => {
  const kap = (metin) => {
    const d = document.createElement('div')
    d.appendChild(linkliMetin(metin))
    return d
  }
  it('link yeni sekmede, noopener noreferrer ile açılır', () => {
    const a = kap('bak https://a.com/x').querySelector('a')
    expect(a.getAttribute('href')).toBe('https://a.com/x')
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener noreferrer')
    expect(a.className).toBe('msg-link')
    expect(a.textContent).toBe('https://a.com/x')
  })
  it('kötü niyetli metin HTML olarak çalışmaz', () => {
    const d = kap('<img src=x onerror=alert(1)> https://a.com/"><img src=x onerror=alert(2)>')
    expect(d.querySelector('img')).toBeNull()
    expect(d.querySelectorAll('a')).toHaveLength(1)
    expect(d.querySelector('a').getAttribute('href')).toBe('https://a.com/')
    expect(d.textContent).toBe('<img src=x onerror=alert(1)> https://a.com/"><img src=x onerror=alert(2)>')
  })
  it('javascript: metni link olmaz, olduğu gibi yazılır', () => {
    const d = kap('javascript:alert(1)')
    expect(d.querySelector('a')).toBeNull()
    expect(d.textContent).toBe('javascript:alert(1)')
  })
  it('metnin tamamı korunur (noktalama dahil)', () => {
    expect(kap('(bkz. https://a.com).').textContent).toBe('(bkz. https://a.com).')
  })
})

describe('görünmez karakterler', () => {
  // Sıfır genişlikli / yön değiştiren karakterler adresin içine giremez: adres orada biter.
  const gizliler = ['​', '‌', '‍', '‎', '‏', '‪', '‮', '⁠', '⁤', '﻿', '­']
  for (const g of gizliler) {
    it(`U+${g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} adresi böler, link gizli karakter taşımaz`, () => {
      const girdi = `bak https://a.com/x${g}evil.com/y bitti`
      const parcalar = linkParcalari(girdi)
      const link = parcalar.find((p) => p.link)
      expect(link.metin).toBe('https://a.com/x')
      expect(link.href).not.toContain('evil')
      expect(parcalar.map((p) => p.metin).join('')).toBe(girdi) // metin aynen geri gelir
    })
  }
  it('gizli karakter olmayan linkler etkilenmez', () => {
    expect(ozet('https://a.com/ö-ğ?x=1')).toBe('[https://a.com/ö-ğ?x=1]')
  })
})
