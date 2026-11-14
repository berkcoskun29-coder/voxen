// Roller ve izinler: saf kurallar (src/data/rolKurallari.js). Kurallar 013_roller.sql ile aynı olmalı.
import { describe, it, expect } from 'vitest'
import {
  IZINLER, IZIN_ADLARI, ROL_RENKLERI, EN_UST_SIRA, rolRengiCss, siraliRoller, kisininRolleri, ustSira, yetkiHesapla,
  rolDuzenlenebilir, rolSilinebilir, rolTasinabilir, izinDegistirilebilir, rolAtanabilir, cikarilabilir, kisiGorunumu, uyeGruplari,
} from '../src/data/rolKurallari.js'

const SAHIP = 'sahip'
const server = { id: 's1', owner_id: SAHIP }
const herkes = { id: 'r0', name: '@herkes', position: 0, is_default: true, permissions: [], color: null, hoist: false }
const yonetici = { id: 'r3', name: 'Yönetici', position: 3, is_default: false, permissions: ['MANAGE_ROLES', 'KICK_MEMBERS', 'MANAGE_MESSAGES'], color: 'kirmizi', hoist: true }
const mod = { id: 'r2', name: 'Mod', position: 2, is_default: false, permissions: ['MANAGE_MESSAGES'], color: null, hoist: true }
const dj = { id: 'r1', name: 'DJ', position: 1, is_default: false, permissions: ['MANAGE_CHANNELS'], color: 'mavi', hoist: false }
const roles = [dj, herkes, yonetici, mod]
const memberRoles = [
  { user_id: 'ali', role_id: 'r3' },
  { user_id: 'ayla', role_id: 'r2' }, { user_id: 'ayla', role_id: 'r1' },
  { user_id: 'can', role_id: 'r1' },
]
const y = (userId, extra = {}) => yetkiHesapla({ server, roles: extra.roles ?? roles, memberRoles, userId })

describe('sabitler', () => {
  it('6 izin, SQL ile aynı sıra; her birinin Türkçe adı ve açıklaması var', () => {
    expect(IZIN_ADLARI).toEqual(['MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'KICK_MEMBERS', 'MANAGE_ROLES', 'MANAGE_SERVER', 'MENTION_EVERYONE'])
    for (const i of IZINLER) { expect(i.baslik).toBeTruthy(); expect(i.aciklama).toBeTruthy() }
  })
  it('8 renk; CSS tema değişkenine çevrilir, bilinmeyen null', () => {
    expect(ROL_RENKLERI).toHaveLength(8)
    expect(rolRengiCss('mavi')).toBe('var(--rol-mavi)')
    expect(rolRengiCss(null)).toBeNull()
    expect(rolRengiCss('red; x')).toBeNull()
  })
})

describe('sıralama ve yetki hesabı', () => {
  it('siraliRoller: en yüksek üstte, @herkes en altta', () => {
    expect(siraliRoller(roles).map((r) => r.id)).toEqual(['r3', 'r2', 'r1', 'r0'])
  })
  it('kisininRolleri / ustSira', () => {
    expect(kisininRolleri(roles, memberRoles, 'ayla').map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(ustSira(server, roles, memberRoles, 'ayla')).toBe(2)
    expect(ustSira(server, roles, memberRoles, 'yeni')).toBe(0)
    expect(ustSira(server, roles, memberRoles, SAHIP)).toBe(EN_UST_SIRA)
  })
  it('sahip her izne sahip; üye @herkes + rollerinin birleşimi', () => {
    expect([...y(SAHIP).izinler].sort()).toEqual([...IZIN_ADLARI].sort())
    expect(y(SAHIP).sahip).toBe(true)
    expect([...y('ayla').izinler].sort()).toEqual(['MANAGE_CHANNELS', 'MANAGE_MESSAGES'])
    expect(y('yeni').izinler.size).toBe(0)
    const herkesli = [{ ...herkes, permissions: ['MENTION_EVERYONE'] }, dj, mod, yonetici]
    expect(y('yeni', { roles: herkesli }).has('MENTION_EVERYONE')).toBe(true)
    expect(yetkiHesapla().has('MANAGE_ROLES')).toBe(false)
  })
})

describe('hiyerarşi (SQL ile aynı)', () => {
  it('rol düzenleme: yalnız üst sıramın altındakiler; @herkes her rol yöneticisine; yöneticisiz hayır', () => {
    const ali = y('ali') // üst sıra 3, MANAGE_ROLES
    expect(rolDuzenlenebilir(ali, mod)).toBe(true)
    expect(rolDuzenlenebilir(ali, yonetici)).toBe(false) // kendi en yüksek rolü
    expect(rolDuzenlenebilir(ali, herkes)).toBe(true)
    expect(rolDuzenlenebilir(y('ayla'), dj)).toBe(false) // MANAGE_ROLES yok
    expect(rolDuzenlenebilir(y(SAHIP), yonetici)).toBe(true)
  })
  it('silme/taşıma: @herkes asla; hedef de üst sıranın altında', () => {
    const ali = y('ali')
    expect(rolSilinebilir(ali, herkes)).toBe(false)
    expect(rolSilinebilir(ali, mod)).toBe(true)
    expect(rolTasinabilir(ali, mod, 1)).toBe(true)
    expect(rolTasinabilir(ali, dj, 3)).toBe(false)
    expect(rolTasinabilir(y(SAHIP), dj, 3)).toBe(true)
  })
  it('izin değiştirme: yalnız kendimde olan izin', () => {
    expect(izinDegistirilebilir(y('ali'), 'KICK_MEMBERS')).toBe(true)
    expect(izinDegistirilebilir(y('ali'), 'MANAGE_SERVER')).toBe(false)
    expect(izinDegistirilebilir(y(SAHIP), 'MANAGE_SERVER')).toBe(true)
  })
  it('atama: rol ve kişi altımda olmalı; verirken rolün izinleri bende olmalı; kendime alttaki rolü verebilirim', () => {
    const ali = y('ali')
    expect(rolAtanabilir(ali, mod, { hedefUstSira: 1 })).toBe(true)
    expect(rolAtanabilir(ali, yonetici, { hedefUstSira: 0 })).toBe(false)
    expect(rolAtanabilir(ali, mod, { hedefUstSira: 3 })).toBe(false) // eşit kişi
    expect(rolAtanabilir(ali, mod, { hedefUstSira: 3, benMi: true })).toBe(true)
    expect(rolAtanabilir(ali, dj, { hedefUstSira: 0 })).toBe(false) // DJ'nin MANAGE_CHANNELS izni Ali'de yok
    expect(rolAtanabilir(ali, dj, { hedefUstSira: 1, ver: false })).toBe(true) // almak serbest
    expect(rolAtanabilir(ali, herkes, {})).toBe(false)
    expect(rolAtanabilir(y(SAHIP), yonetici, { hedefUstSira: 3 })).toBe(true)
  })
  it('çıkarma: KICK_MEMBERS, kendini ve eşit/üsttekini hayır', () => {
    const ali = y('ali')
    expect(cikarilabilir(ali, { hedefUstSira: 2 })).toBe(true)
    expect(cikarilabilir(ali, { hedefUstSira: 3 })).toBe(false)
    expect(cikarilabilir(ali, { hedefUstSira: EN_UST_SIRA })).toBe(false) // sahip
    expect(cikarilabilir(ali, { hedefUstSira: 0, benMi: true })).toBe(false)
    expect(cikarilabilir(y('ayla'), { hedefUstSira: 0 })).toBe(false)
    expect(cikarilabilir(y(SAHIP), { hedefUstSira: 3 })).toBe(true)
  })
})

describe('görünüm', () => {
  it('renk: en yüksek RENKLİ rol; ayrı gösterilen: en yüksek hoist', () => {
    expect(kisiGorunumu(roles, memberRoles, 'ayla')).toMatchObject({ renk: 'var(--rol-mavi)', ayriRol: { id: 'r2' } })
    expect(kisiGorunumu(roles, memberRoles, 'ali')).toMatchObject({ renk: 'var(--rol-kirmizi)', ayriRol: { id: 'r3' } })
    expect(kisiGorunumu(roles, memberRoles, 'yeni')).toMatchObject({ renk: null, ayriRol: null, roller: [] })
  })
  it('uyeGruplari: çevrimiçiler ayrı rollere göre (rol sırasıyla), sonra Çevrimiçi ve Çevrimdışı; boş grup yok', () => {
    const uyeler = ['ali', 'ayla', 'can', 'yeni', 'uyku'].map((id) => ({ id, username: id }))
    const gruplar = uyeGruplari(uyeler, (id) => id !== 'uyku', roles, memberRoles)
    expect(gruplar.map((g) => [g.baslik, g.kisiler.map((k) => k.id)])).toEqual([
      ['Yönetici', ['ali']], ['Mod', ['ayla']], ['Çevrimiçi', ['can', 'yeni']], ['Çevrimdışı', ['uyku']],
    ])
    expect(uyeGruplari([], () => true)).toEqual([])
  })
})
