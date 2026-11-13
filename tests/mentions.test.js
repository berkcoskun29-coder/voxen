// @bahsetme eşleşmesi (src/mentions.js): kural veritabanındaki mentions_user ile aynı
// (007_sosyal.sql): büyük-küçük harf duyarsız, "@"tan önce ve addan sonra harf/rakam/_ olmamalı.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mentionsUser, findMentions } from '../src/mentions.js'

describe('mentionsUser', () => {
  // [metin, ad, beklenen]
  const tablo = [
    ['@berk', 'berk', true],
    ['selam @berk', 'berk', true],
    ['@berk selam', 'berk', true],
    ['@BERK', 'berk', true], // büyük-küçük harf duyarsız
    ['@Berk', 'BERK', true],
    ['@berk.', 'berk', true], // noktalama sınırdır
    ['@berk,', 'berk', true],
    ['@berk!', 'berk', true],
    ['(@berk)', 'berk', true],
    ['@berk@ali', 'berk', true], // "@" harf/rakam değil
    ['satır\n@berk', 'berk', true],
    ['@berkcan', 'berk', false], // addan sonra harf: başka kişi
    ['@berk_', 'berk', false], // _ da kelimenin parçası
    ['@berk1', 'berk', false], // rakam da
    ['@berkç', 'berk', false], // Türkçe harf de (Unicode)
    ['x@berk', 'berk', false], // önünde harf: e-posta gibi
    ['_@berk', 'berk', false],
    ['1@berk', 'berk', false],
    ['ş@berk', 'berk', false],
    ['berk', 'berk', false], // @ yok
    ['@ berk', 'berk', false],
    ['@ber', 'berk', false], // adın yarısı
    ['', 'berk', false],
    [null, 'berk', false],
    ['@berk', '', false],
    ['@berk', null, false],
    // Kullanıcı adında düzenli ifade işaretleri ve boşluk olabilir (yalnız 3–20 uzunluk kuralı var)
    ['@a.b selam', 'a.b', true],
    ['@axb selam', 'a.b', false], // "." her karakteri değil, yalnız noktayı tutar
    ['@c++ dedi', 'c++', true],
    ['@(x) bak', '(x)', true],
    ['@[a]', '[a]', true],
    ['@a|b', 'a|b', true],
    ['@a', 'a|b', false],
    ['@a\\b', 'a\\b', true],
    ['@a-b.', 'a-b', true],
    ['@a/b', 'a/b', true],
    ['@Berk Can geldi', 'Berk Can', true],
    ['@Berk Cansu', 'Berk Can', false],
    ['@çağrı.', 'Çağrı', true],
  ]
  it.each(tablo)('%j / %j -> %s', (metin, ad, beklenen) => {
    expect(mentionsUser(metin, ad)).toBe(beklenen)
  })

  it('aynı ifade art arda kullanılınca da doğru sonuç verir (global ifadenin lastIndex tuzağı yok)', () => {
    for (let i = 0; i < 3; i++) expect(mentionsUser('selam @berk', 'berk')).toBe(true)
  })

  it('veritabanındaki kuralla aynı sınırı kullanır (007_sosyal.sql mentions_user)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/007_sosyal.sql'), 'utf8')
    expect(sql).toContain("'(^|[^[:alnum:]_])@'")
    expect(sql).toContain("'($|[^[:alnum:]_])'")
  })
})

describe('findMentions', () => {
  it('üyelerin anıldığı yerleri sırayla, yazıldığı listeyle verir', () => {
    expect(findMentions('@ali ve @Berk.', ['berk', 'ali', 'can'])).toEqual([
      { start: 0, end: 4, username: 'ali' },
      { start: 8, end: 13, username: 'berk' },
    ])
  })

  it('kelime sınırına uyar: @berkcan, x@berk eşleşmez', () => {
    expect(findMentions('@berkcan x@berk', ['berk'])).toEqual([])
  })

  it('aynı yerden iki ad eşleşirse uzun olan alınır', () => {
    expect(findMentions('@Berk Can geldi', ['Berk', 'Berk Can'])).toEqual([{ start: 0, end: 9, username: 'Berk Can' }])
    expect(findMentions('@Berk geldi', ['Berk', 'Berk Can'])).toEqual([{ start: 0, end: 5, username: 'Berk' }])
  })

  it('bir ad birden çok kez anılabilir', () => {
    expect(findMentions('@ali @ali', ['ali']).map((b) => b.start)).toEqual([0, 5])
  })

  it('boş metin, @ yok ya da ad listesi boşsa boş dizi', () => {
    expect(findMentions('', ['a'])).toEqual([])
    expect(findMentions('selam', ['selam'])).toEqual([])
    expect(findMentions('@ali', [])).toEqual([])
    expect(findMentions('@ali', null)).toEqual([])
  })
})
