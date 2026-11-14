import { describe, it, expect } from 'vitest'
import {
  katla, normallestir, kelimeler, aramaCozumle, aramaUyarisi, vurguParcalari, oneriler, oneriUygula,
  ARAMA_UYARILARI, FILTRELER,
} from '../src/data/aramaFiltre.js'

describe('katlama (sunucudaki arama_metni ile aynı kural)', () => {
  it('Türkçe I/İ/ı hepsi i olur', () => {
    expect(normallestir('İstanbul')).toBe('istanbul')
    expect(normallestir('ISTANBUL')).toBe('istanbul')
    expect(normallestir('ılık Ilık')).toBe('ilik ilik')
  })
  it('aksanlar atılır', () => {
    expect(normallestir('Şeker Ğ Çiçek Öğün Üzüm âşık')).toBe('seker g cicek ogun uzum asik')
    expect(normallestir('Straße Æ')).toBe('strasse ae')
  })
  it('kaynak dizisi her birimi özgün harfe bağlar (emoji bölünmez)', () => {
    const k = katla('aß😀İ')
    expect(k.metin).toBe('ass😀i'.normalize('NFD').replace(/\p{M}/gu, ''))
    expect(k.harfler).toEqual(['a', 'ß', '😀', 'İ'])
    expect(k.kaynak[1]).toBe(1)
    expect(k.kaynak[2]).toBe(1)
    expect(k.kaynak.at(-1)).toBe(3)
  })
  it('kelimeler: katlanmış, tekrarsız', () => {
    expect(kelimeler('  Merhaba  MERHABA dünya ')).toEqual(['merhaba', 'dunya'])
  })
})

describe('aramaCozumle', () => {
  it('düz metin ve filtreler ayrılır', () => {
    const c = aramaCozumle('oyun kimden:@ayla akşam kanal:#genel ek:var')
    expect(c.metin).toBe('oyun akşam')
    expect(c.kimden).toBe('ayla')
    expect(c.kanal).toBe('genel')
    expect(c.ek).toBe(true)
    expect(c.hatalar).toEqual([])
  })
  it('anahtarlar büyük-küçük harf ve aksan duyarsız; tırnaklı değer', () => {
    const c = aramaCozumle('KİMDEN:Berk Kanal:"oyun odası" x')
    expect(c.kimden).toBe('Berk')
    expect(c.kanal).toBe('oyun odası')
    expect(c.metin).toBe('x')
  })
  it('tarih: önce günün başı, sonra ertesi günün başı (yerel)', () => {
    const c = aramaCozumle('önce:2026-11-05 sonra:2026-11-01')
    expect(new Date(c.once).getTime()).toBe(new Date(2026, 10, 5).getTime())
    expect(new Date(c.sonra).getTime()).toBe(new Date(2026, 10, 2).getTime())
    expect(aramaCozumle('once:2026-11-05').once).toBe(c.once)
  })
  it('hatalı tarih, ek değeri ve DM\'de kanal uyarı verir', () => {
    expect(aramaCozumle('önce:2026-02-30').hatalar).toEqual([ARAMA_UYARILARI.tarih])
    expect(aramaCozumle('sonra:dün').hatalar).toEqual([ARAMA_UYARILARI.tarih])
    expect(aramaCozumle('ek:yok').hatalar).toEqual([ARAMA_UYARILARI.ek])
    const d = aramaCozumle('kanal:genel selam', { kapsam: 'dm' })
    expect(d.hatalar).toEqual([ARAMA_UYARILARI.kanalDm])
    expect(d.kanal).toBe(null)
  })
  it('tanınmayan "x:y" düz metindir; boş değerli filtre yok sayılır; tırnak atılır', () => {
    const c = aramaCozumle('saat 12:30 kimden: "selam"')
    expect(c.metin).toBe('saat 12:30 selam')
    expect(c.kimden).toBe(null)
  })
})

describe('aramaUyarisi', () => {
  const u = (g, o) => aramaUyarisi(aramaCozumle(g, o))
  it('boş kutu: uyarı yok, arama yok', () => expect(u('   ')).toBe(''))
  it('tek karakter kısa; filtreyle bile metin 2 karakter olmalı', () => {
    expect(u('a')).toBe(ARAMA_UYARILARI.kisa)
    expect(u('a kimden:ayla')).toBe(ARAMA_UYARILARI.kisa)
    expect(u('ab')).toBe(null)
    expect(u('a b')).toBe(null) // boşluksuz 2 karakter
  })
  it('yalnız filtreyle arama olur', () => expect(u('kimden:ayla')).toBe(null))
  it('çok uzun ve çok kelime', () => {
    expect(u('x'.repeat(201))).toBe(ARAMA_UYARILARI.uzun)
    expect(u('a1 a2 a3 a4 a5 a6 a7 a8 a9')).toBe(ARAMA_UYARILARI.kelime)
  })
  it('hata önce gelir', () => expect(u('önce:bugün selam')).toBe(ARAMA_UYARILARI.tarih))
})

describe('vurguParcalari', () => {
  const birlestir = (p) => p.map((x) => (x.vurgu ? `[${x.yazi}]` : x.yazi)).join('')
  it('Türkçe katlamayla eşleşen kısım vurgulanır, özgün yazı korunur', () => {
    expect(birlestir(vurguParcalari('Yarın İstanbul’a gidiyoruz', 'istanbul'))).toBe('Yarın [İstanbul]’a gidiyoruz')
    expect(birlestir(vurguParcalari('ŞEKER aldım', 'seker'))).toBe('[ŞEKER] aldım')
  })
  it('birden çok kelime ve tekrar; çakışan aralıklar birleşir', () => {
    expect(birlestir(vurguParcalari('oyun oynayalım mı oyun', 'oyun oyna'))).toBe('[oyun] [oyna]yalım mı [oyun]')
  })
  it('uzun metinde eşleşmenin çevresi alınır', () => {
    const metin = 'a'.repeat(300) + ' hedef ' + 'b'.repeat(300)
    const p = vurguParcalari(metin, 'hedef', { uzunluk: 40 })
    expect(p[0]).toEqual({ yazi: '…', vurgu: false })
    expect(p.at(-1)).toEqual({ yazi: '…', vurgu: false })
    expect(p.find((x) => x.vurgu).yazi).toBe('hedef')
    expect(Array.from(p.map((x) => x.yazi).join('')).length).toBeLessThanOrEqual(42)
  })
  it('eşleşme yoksa baş kısım vurgusuz', () => {
    expect(vurguParcalari('merhaba', '')).toEqual([{ yazi: 'merhaba', vurgu: false }])
  })
  it('emoji yarıdan bölünmez', () => {
    const p = vurguParcalari('😀😀 kedi', 'kedi', { uzunluk: 6 })
    expect(p.map((x) => x.yazi).join('')).toContain('😀')
    expect(p.map((x) => x.yazi).join('')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('öneriler', () => {
  const bilgi = { kisiler: ['ayla', 'Aylin', 'berk'], kanallar: ['genel', 'oyun odası'] }
  it('boş kutuda bütün filtreler (yardım); DM\'de kanal yok', () => {
    expect(oneriler('', 0, bilgi).liste.map((o) => o.ekle)).toEqual(FILTRELER.map((f) => f.ekle))
    expect(oneriler('', 0, { ...bilgi, kapsam: 'dm' }).liste.map((o) => o.ekle)).not.toContain('kanal:')
  })
  it('anahtar başı yazılınca anahtar önerilir', () => {
    expect(oneriler('selam ki', 8, bilgi).liste.map((o) => o.ekle)).toEqual(['kimden:'])
    expect(oneriler('on', 2, bilgi).liste.map((o) => o.ekle)).toEqual(['önce:'])
  })
  it('kimden: kişiler, kanal: kanallar (boşluklu ad tırnakla)', () => {
    const k = oneriler('kimden:ay', 9, bilgi)
    expect(k.liste.map((o) => o.ekle)).toEqual(['kimden:ayla', 'kimden:Aylin'])
    expect(k.bas).toBe(0)
    const c = oneriler('x kanal:oy', 10, bilgi)
    expect(c.liste).toEqual([{ ekle: 'kanal:"oyun odası"', etiket: '#oyun odası', aciklama: '' }])
    expect(c.bas).toBe(2)
    expect(oneriler('kanal:', 6, { ...bilgi, kapsam: 'dm' }).liste).toEqual([])
  })
  it('tırnak içindeki boşluk kelimeyi bölmez', () => {
    expect(oneriler('kanal:"oyun o', 13, bilgi).liste.map((o) => o.etiket)).toEqual(['#oyun odası'])
  })
  it('oneriUygula: anahtardan sonra boşluk yok, değerden sonra boşluk', () => {
    const o1 = oneriler('selam ki', 8, bilgi)
    expect(oneriUygula('selam ki', o1, o1.liste[0])).toEqual({ metin: 'selam kimden:', imlec: 13 })
    const o2 = oneriler('kimden:ay oyun', 9, bilgi)
    expect(oneriUygula('kimden:ay oyun', o2, o2.liste[0])).toEqual({ metin: 'kimden:ayla oyun', imlec: 11 })
    const o3 = oneriler('kimden:ay', 9, bilgi)
    expect(oneriUygula('kimden:ay', o3, o3.liste[0])).toEqual({ metin: 'kimden:ayla ', imlec: 12 })
  })
})
