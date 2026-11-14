// Roller ve izinler (v0.11.0): saf kurallar (DOM yok, Supabase yok). Asıl koruma veritabanında
// (supabase/migrations/013_roller.sql, has_permission); burası yalnız arayüzün hangi düğmeyi göstereceğini
// hesaplar. Kurallar SQL'dekilerle AYNI olmalı. Doğrulama betiği de bu dosyayı Node'da doğrudan kullanır:
// hiçbir şey içe aktarmaz.

// İzinler: sıra SQL'deki izin_adlari() ile AYNI
export const IZINLER = [
  { ad: 'MANAGE_CHANNELS', baslik: 'Kanalları yönet', aciklama: 'Kanal açma, adlandırma, silme ve sıralama.' },
  { ad: 'MANAGE_MESSAGES', baslik: 'Mesajları yönet', aciklama: 'Başkasının mesajını silme ve mesaj sabitleme.' },
  { ad: 'KICK_MEMBERS', baslik: 'Üye çıkar', aciklama: 'Rolü seninkinden aşağıda olan üyeleri sunucudan çıkarma.' },
  { ad: 'MANAGE_ROLES', baslik: 'Rolleri yönet', aciklama: 'Rol oluşturma, düzenleme ve atama; yalnız kendi en yüksek rolünün altındakiler için.' },
  { ad: 'MANAGE_SERVER', baslik: 'Sunucuyu yönet', aciklama: 'Sunucu adını değiştirme ve davet kodunu yenileme.' },
  { ad: 'MENTION_EVERYONE', baslik: "@herkes'ten bahset", aciklama: '@herkes ya da @everyone yazınca herkese bildirim gider. İzin yoksa düz yazı kalır.' },
]
export const IZIN_ADLARI = IZINLER.map((i) => i.ad)

// 8 hazır tema rengi (src/styles/theme.css: --rol-<anahtar>). null = renksiz.
export const ROL_RENKLERI = [
  { ad: 'kirmizi', baslik: 'Kırmızı' },
  { ad: 'turuncu', baslik: 'Turuncu' },
  { ad: 'sari', baslik: 'Sarı' },
  { ad: 'yesil', baslik: 'Yeşil' },
  { ad: 'turkuaz', baslik: 'Turkuaz' },
  { ad: 'mavi', baslik: 'Mavi' },
  { ad: 'mor', baslik: 'Mor' },
  { ad: 'pembe', baslik: 'Pembe' },
]
export const ROL_RENK_ADLARI = ROL_RENKLERI.map((r) => r.ad)

export const EN_UST_SIRA = 2147483647 // sahibin sırası (bütün rollerin üstünde)
export const ROL_SINIRI = 50 // sunucu başına (@herkes hariç)
export const ROL_ADI_EN_UZUN = 30

// Renk anahtarı -> CSS değeri (tema değişkeni). Bilinmeyen/renksiz: null.
export function rolRengiCss(anahtar) {
  return ROL_RENK_ADLARI.includes(anahtar) ? `var(--rol-${anahtar})` : null
}

// Rolleri gösterim sırasına dizer: en yüksek üstte, @herkes en altta
export function siraliRoller(roles) {
  return [...(roles ?? [])].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? 1 : -1
    return b.position - a.position || String(a.id).localeCompare(String(b.id))
  })
}

// Kişinin atanmış rolleri (@herkes hariç), en yüksek önce
export function kisininRolleri(roles, memberRoles, userId) {
  const idler = new Set((memberRoles ?? []).filter((m) => m.user_id === userId).map((m) => m.role_id))
  return siraliRoller((roles ?? []).filter((r) => !r.is_default && idler.has(r.id)))
}

// Kişinin en yüksek rol sırası: sahip EN_UST_SIRA, rolü yoksa 0 (SQL uye_ust_sira ile aynı; üye değilse -1
// ayrımını arayüz yapmaz)
export function ustSira(server, roles, memberRoles, userId) {
  if (server && userId && server.owner_id === userId) return EN_UST_SIRA
  const r = kisininRolleri(roles, memberRoles, userId)
  return r.length ? r[0].position : 0
}

// Bir kişinin bu sunucudaki yetkisi.
// server: { owner_id }, roles: roles satırları, memberRoles: [{ user_id, role_id }], userId
// Dönen: { sahip, izinler: Set, ustSira, has(perm) }
export function yetkiHesapla({ server = null, roles = [], memberRoles = [], userId = null } = {}) {
  const sahip = !!server && !!userId && server.owner_id === userId
  let izinler
  if (sahip) izinler = new Set(IZIN_ADLARI)
  else {
    izinler = new Set()
    const benimkiler = [...(roles ?? []).filter((r) => r.is_default), ...kisininRolleri(roles, memberRoles, userId)]
    for (const r of benimkiler) for (const p of r.permissions ?? []) if (IZIN_ADLARI.includes(p)) izinler.add(p)
  }
  return {
    sahip,
    izinler,
    ustSira: ustSira(server, roles, memberRoles, userId),
    has: (perm) => izinler.has(perm),
  }
}

// Boş yetki (sunucu yokken)
export const YETKI_YOK = yetkiHesapla()

// Bu rolü (ad/renk/izin) düzenleyebilir miyim? @herkes: yalnız izinler, her rol yöneticisi.
export function rolDuzenlenebilir(yetki, rol) {
  if (!yetki?.has('MANAGE_ROLES') || !rol) return false
  if (yetki.sahip || rol.is_default) return true
  return rol.position < yetki.ustSira
}

// Rol oluşturabilir miyim? Yeni rol @herkes'in hemen üstüne (sıra 1) eklenir, var olan roller bir kayar.
// v0.12 (v11 K3): rolü olmayan (yetkisi yalnız @herkes'ten gelen, üst sırası 0) kişi oluşturduğu rolü
// yönetemezdi; ona düğme gösterilmez (sunucu ROLE_HIERARCHY verir). SQL create_role ile aynı kural.
export function rolOlusturulabilir(yetki) {
  if (!yetki?.has('MANAGE_ROLES')) return false
  return yetki.sahip || yetki.ustSira >= 1
}

// Silebilir / taşıyabilir miyim? (@herkes hiçbir zaman)
export function rolSilinebilir(yetki, rol) {
  return !!rol && !rol.is_default && rolDuzenlenebilir(yetki, rol)
}

// Rolü hedef sıraya taşıyabilir miyim? (hedef de üst sıramın altında olmalı)
export function rolTasinabilir(yetki, rol, hedef) {
  if (!rolSilinebilir(yetki, rol)) return false
  return yetki.sahip || (hedef >= 1 && hedef < yetki.ustSira)
}

// Bu izni bir role verebilir/alabilir miyim? (kendimde olmalı)
export function izinDegistirilebilir(yetki, izin) {
  return !!yetki?.has(izin)
}

// Rolü bu kişiye verebilir/alabilir miyim?
// hedefUstSira: kişinin en yüksek rol sırası; benMi: kişi ben miyim; ver: true verme, false alma
export function rolAtanabilir(yetki, rol, { hedefUstSira = 0, benMi = false, ver = true } = {}) {
  if (!yetki?.has('MANAGE_ROLES') || !rol || rol.is_default) return false
  if (yetki.sahip) return true
  if (rol.position >= yetki.ustSira) return false
  if (!benMi && hedefUstSira >= yetki.ustSira) return false
  if (ver && !(rol.permissions ?? []).every((p) => yetki.has(p))) return false
  return true
}

// Bu kişiyi sunucudan çıkarabilir miyim? (kendimi ve üst sırası benimkine eşit/yüksek olanı hayır)
export function cikarilabilir(yetki, { hedefUstSira = 0, benMi = false } = {}) {
  if (!yetki?.has('KICK_MEMBERS') || benMi) return false
  return hedefUstSira < yetki.ustSira
}

// Kişinin görünümü: rengi (en yüksek RENKLİ rolün tema değişkeni, yoksa null), ayrı gösterildiği rol
// (en yüksek "ayrı göster" rolü, yoksa null) ve atanmış rolleri (en yüksek önce).
export function kisiGorunumu(roles, memberRoles, userId) {
  const roller = kisininRolleri(roles, memberRoles, userId)
  const renkli = roller.find((r) => rolRengiCss(r.color))
  return {
    renk: renkli ? rolRengiCss(renkli.color) : null,
    ayriRol: roller.find((r) => r.hoist) ?? null,
    roller,
  }
}

// Üye listesi grupları: çevrimiçiler en yüksek "ayrı göster" rolüne göre (rol sırasıyla), kalan
// çevrimiçiler "Çevrimiçi", çevrimdışılar "Çevrimdışı". Boş grup dönmez.
// members: profiller; cevrimici(id) -> boolean. Dönen: [{ anahtar, baslik, kisiler }]
export function uyeGruplari(members, cevrimici, roles = [], memberRoles = []) {
  const ayriGruplar = new Map() // rolId -> kisiler
  const cevrimiciler = []
  const cevrimdisilar = []
  for (const m of members ?? []) {
    if (!cevrimici(m.id)) { cevrimdisilar.push(m); continue }
    const rol = kisiGorunumu(roles, memberRoles, m.id).ayriRol
    if (rol) {
      if (!ayriGruplar.has(rol.id)) ayriGruplar.set(rol.id, [])
      ayriGruplar.get(rol.id).push(m)
    } else cevrimiciler.push(m)
  }
  const gruplar = []
  for (const rol of siraliRoller(roles)) {
    const kisiler = ayriGruplar.get(rol.id)
    if (kisiler?.length) gruplar.push({ anahtar: `rol-${rol.id}`, baslik: rol.name, kisiler })
  }
  if (cevrimiciler.length) gruplar.push({ anahtar: 'cevrimici', baslik: 'Çevrimiçi', kisiler: cevrimiciler })
  if (cevrimdisilar.length) gruplar.push({ anahtar: 'cevrimdisi', baslik: 'Çevrimdışı', kisiler: cevrimdisilar })
  return gruplar
}
