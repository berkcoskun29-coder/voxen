// Mesaj arama (v0.10.0): kutuya yazılanı ayrıştırma, Türkçe/aksan katlama, vurgu parçaları ve öneriler.
// Hiçbir şey içe aktarmaz (saf fonksiyonlar; testler ve doğrulama betiği de kullanır).
// Sunucudaki karşılık: supabase/migrations/012_mesaj_arama.sql (arama_metni, search_messages).

export const ARAMA_SAYFA = 25 // sayfa başına sonuç
export const ARAMA_EN_AZ = 2 // en az karakter (boşluksuz)
export const ARAMA_EN_UZUN = 200 // sorgunun en çok uzunluğu (filtreler ayıklandıktan sonra)
export const ARAMA_EN_COK_KELIME = 8
export const ARAMA_GECIKME_MS = 300 // yazarken bekleme (debounce)

// Kutudaki uyarı metinleri
export const ARAMA_UYARILARI = {
  kisa: 'En az 2 karakter yaz.',
  uzun: 'Arama çok uzun.',
  kelime: 'En fazla 8 kelimeyle ara.',
  tarih: 'Tarih YYYY-AA-GG biçiminde olmalı (ör. 2026-11-01).',
  ek: 'ek: yalnız "var" alır (ek:var).',
  kanalDm: 'kanal: yalnız sunucuda kullanılır.',
}

// ---------- Katlama ----------
// Sunucudaki arama_metni ile aynı kural: İ/I/ı → i, aksanlar atılır (ş→s, ğ→g, ç→c, ö→o, ü→u, â→a), küçük harf.
// unaccent'in harf açılımlarından sık olanlar da (ß→ss, æ→ae ...).
const OZEL = { İ: 'i', I: 'i', ı: 'i', ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ł: 'l', Ł: 'l' }
function harfKatla(h) {
  if (Object.hasOwn(OZEL, h)) return OZEL[h]
  return h.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Metni katlar ve her katlanmış birimin özgün metindeki yerini tutar (vurgu için).
// Konumlar KOD NOKTASI sırasıdır (emoji bölünmez): harfler = Array.from(metin).
// Dönüş: { metin, harfler, kaynak } — kaynak[i]: katlanmış metnin i. biriminin geldiği harfin sırası.
export function katla(metin) {
  const harfler = Array.from(String(metin ?? ''))
  let sonuc = ''
  const kaynak = []
  harfler.forEach((h, j) => {
    const k = harfKatla(h)
    for (let u = 0; u < k.length; u++) kaynak.push(j)
    sonuc += k
  })
  return { metin: sonuc, harfler, kaynak }
}
export const normallestir = (metin) => katla(metin).metin

// Aranan metnin kelimeleri (katlanmış, tekrarsız, boşsuz)
export function kelimeler(metin) {
  return [...new Set(normallestir(metin).split(/\s+/).filter(Boolean))]
}

// ---------- Ayrıştırma ----------
// Filtre anahtarları (katlanmış ad -> alan). "önce" katlanınca "once" olur: ikisi de kabul edilir.
const ANAHTARLAR = { kimden: 'kimden', kanal: 'kanal', once: 'once', sonra: 'sonra', ek: 'ek' }

// Kutudaki yazıyı ayrıştırır. kapsam: 'sunucu' | 'dm'.
// Dönüş: { metin, kimden, kanal, once, sonra, ek, hatalar: [metin] }
//   once / sonra: ISO zaman (yerel gün sınırı): önce:G → G'nin başı; sonra:G → G+1'in başı.
//   Değeri boş filtre ("kimden:" yazılırken) yok sayılır. Tanınmayan "x:y" düz metindir (ör. 12:30).
export function aramaCozumle(girdi, { kapsam = 'sunucu' } = {}) {
  const c = { metin: '', kimden: null, kanal: null, once: null, sonra: null, ek: false, hatalar: [] }
  const metinler = []
  const desen = /(\S+?):(?:"([^"]*)"?|(\S*))|(\S+)/g
  for (const e of String(girdi ?? '').matchAll(desen)) {
    if (e[4] !== undefined) {
      const kelime = e[4].replace(/^"+|"+$/g, '') // "iki kelime" yazılırsa tırnaklar aranmaz
      if (kelime) metinler.push(kelime)
      continue
    }
    const alan = ANAHTARLAR[normallestir(e[1])]
    const deger = (e[2] ?? e[3] ?? '').trim()
    if (!alan) { metinler.push(e[0]); continue }
    if (!deger) continue
    if (alan === 'kimden') c.kimden = deger.replace(/^@/, '')
    else if (alan === 'kanal') {
      if (kapsam === 'dm') c.hatalar.push(ARAMA_UYARILARI.kanalDm)
      else c.kanal = deger.replace(/^#/, '')
    } else if (alan === 'ek') {
      if (normallestir(deger) === 'var') c.ek = true
      else c.hatalar.push(ARAMA_UYARILARI.ek)
    } else {
      const gun = gunBasi(deger, alan === 'sonra' ? 1 : 0)
      if (!gun) c.hatalar.push(ARAMA_UYARILARI.tarih)
      else c[alan] = gun
    }
  }
  c.metin = metinler.join(' ').trim()
  c.hatalar = [...new Set(c.hatalar)]
  return c
}

// "2026-11-01" -> o günün (ileri: +gun) yerel başlangıcı (ISO). Geçersizse null.
function gunBasi(deger, ileri) {
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deger)
  if (!e) return null
  const [y, a, g] = [Number(e[1]), Number(e[2]), Number(e[3])]
  const t = new Date(y, a - 1, g)
  if (t.getFullYear() !== y || t.getMonth() !== a - 1 || t.getDate() !== g) return null // 2026-02-30 gibi
  t.setDate(t.getDate() + ileri)
  return t.toISOString()
}

const filtreVar = (c) => !!(c.kimden || c.kanal || c.once || c.sonra || c.ek)

// Ayrıştırılmış arama gönderilebilir mi? Gönderilemezse kutunun altında gösterilecek uyarı, yoksa null.
// Boş kutu (metin de filtre de yok) için '' döner: uyarı yok, arama da yok.
export function aramaUyarisi(c) {
  if (c.hatalar.length) return c.hatalar[0]
  if (!c.metin && !filtreVar(c)) return ''
  if (c.metin.length > ARAMA_EN_UZUN) return ARAMA_UYARILARI.uzun
  const k = kelimeler(c.metin)
  if (k.length > ARAMA_EN_COK_KELIME) return ARAMA_UYARILARI.kelime
  if (c.metin && k.join('').length < ARAMA_EN_AZ) return ARAMA_UYARILARI.kisa
  return null
}

// ---------- Vurgulu parça ----------
// Mesaj metninden eşleşmenin çevresini alır. Dönüş: [{ yazi, vurgu }] (vurgu: <mark> ile gösterilir).
// Eşleşme bulunamazsa (yalnız filtreyle arama) metnin başı vurgusuz döner. uzunluk: kod noktası.
export function vurguParcalari(icerik, metin, { uzunluk = 160 } = {}) {
  const k = katla(icerik)
  const n = k.harfler.length
  // Eşleşmeler özgün harf aralıklarına çevrilir: [bas, son)
  const araliklar = []
  for (const kelime of kelimeler(metin)) {
    let i = k.metin.indexOf(kelime)
    while (i >= 0) {
      araliklar.push([k.kaynak[i], k.kaynak[i + kelime.length - 1] + 1])
      i = k.metin.indexOf(kelime, i + kelime.length)
    }
  }
  araliklar.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const birlesik = []
  for (const a of araliklar) {
    const son = birlesik.at(-1)
    if (son && a[0] <= son[1]) son[1] = Math.max(son[1], a[1])
    else birlesik.push([...a])
  }
  // Pencere: ilk eşleşme ortaya yakın
  let bas = 0
  if (birlesik.length && n > uzunluk) {
    const ilk = birlesik[0]
    bas = Math.max(0, Math.min(ilk[0] - Math.floor((uzunluk - (ilk[1] - ilk[0])) / 2), n - uzunluk))
  }
  const bitis = Math.min(n, bas + uzunluk)
  const parcalar = []
  const ekle = (yazi, vurgu) => { if (yazi) parcalar.push({ yazi, vurgu }) }
  if (bas > 0) ekle('…', false)
  let i = bas
  for (const [a, b] of birlesik) {
    if (b <= bas || a >= bitis) continue
    ekle(k.harfler.slice(i, Math.max(i, a)).join(''), false)
    ekle(k.harfler.slice(Math.max(a, i), Math.min(b, bitis)).join(''), true)
    i = Math.min(b, bitis)
  }
  ekle(k.harfler.slice(i, bitis).join(''), false)
  if (bitis < n) ekle('…', false)
  return parcalar
}

// ---------- Öneriler ----------
// Filtre listesi (yardım ipucu da budur). ekle: kutuya yazılacak; aciklama: listede yanında görünen.
export const FILTRELER = [
  { ekle: 'kimden:', aciklama: 'Yazara göre (kimden:ayla)', alan: 'kimden' },
  { ekle: 'kanal:', aciklama: 'Kanala göre (yalnız sunucuda)', alan: 'kanal' },
  { ekle: 'önce:', aciklama: 'Bu tarihten önce (önce:2026-11-01)', alan: 'once' },
  { ekle: 'sonra:', aciklama: 'Bu tarihten sonra (sonra:2026-11-01)', alan: 'sonra' },
  { ekle: 'ek:var', aciklama: 'Eki olan mesajlar', alan: 'ek' },
]
const EN_COK_ONERI = 8
const tirnakla = (ad) => (/\s/.test(ad) ? `"${ad}"` : ad)

// Kutunun imleç konumuna göre öneriler. kisiler: [ad], kanallar: [ad].
// Dönüş: { bas, son, liste: [{ ekle, etiket, aciklama }] } — seçilince girdi[bas, son) yerine ekle yazılır.
export function oneriler(girdi, imlec, { kapsam = 'sunucu', kisiler = [], kanallar = [] } = {}) {
  const yazi = String(girdi ?? '')
  const im = Math.max(0, Math.min(imlec ?? yazi.length, yazi.length))
  // İmlecin bulunduğu kelimenin başı (tırnak içindeki boşluk kelimeyi bölmez)
  let bas = 0
  let tirnakta = false
  for (let i = 0; i < im; i++) {
    if (yazi[i] === '"') tirnakta = !tirnakta
    else if (/\s/.test(yazi[i]) && !tirnakta) bas = i + 1
  }
  const parca = yazi.slice(bas, im)
  const filtreler = FILTRELER.filter((f) => kapsam !== 'dm' || f.alan !== 'kanal')
  const sonuc = (liste) => ({ bas, son: im, liste: liste.slice(0, EN_COK_ONERI) })

  if (!parca) {
    // Boş kutu: bütün filtreler (yardım). Yazının ortasında boş kelime: öneri yok.
    return sonuc(yazi.trim() === '' ? filtreler.map((f) => ({ ekle: f.ekle, etiket: f.ekle, aciklama: f.aciklama })) : [])
  }
  const iki = parca.indexOf(':')
  if (iki > 0) {
    const alan = ANAHTARLAR[normallestir(parca.slice(0, iki))]
    const anahtar = parca.slice(0, iki + 1)
    const deger = normallestir(parca.slice(iki + 1).replace(/^["@#]/, '').replace(/"$/, ''))
    const uyan = (adlar) => [...new Set(adlar)].filter((ad) => ad && normallestir(ad).startsWith(deger))
      .sort((a, b) => a.localeCompare(b, 'tr'))
      .map((ad) => ({ ekle: anahtar + tirnakla(ad), etiket: ad, aciklama: '' }))
    if (alan === 'kimden') return sonuc(uyan(kisiler))
    if (alan === 'kanal' && kapsam !== 'dm') return sonuc(uyan(kanallar).map((o) => ({ ...o, etiket: `#${o.etiket}` })))
    if (alan === 'ek' && 'var'.startsWith(deger)) return sonuc([{ ekle: `${anahtar}var`, etiket: 'var', aciklama: 'Eki olan mesajlar' }])
    return sonuc([])
  }
  const p = normallestir(parca)
  return sonuc(filtreler.filter((f) => normallestir(f.ekle).startsWith(p))
    .map((f) => ({ ekle: f.ekle, etiket: f.ekle, aciklama: f.aciklama })))
}

// Öneriyi girdiye uygular. Dönüş: { metin, imlec }. Anahtar seçildiyse (":" ile biten) boşluk eklenmez.
export function oneriUygula(girdi, { bas, son }, oneri) {
  const yazi = String(girdi ?? '')
  const sonra = yazi.slice(son)
  const ara = oneri.ekle.endsWith(':') || /^\s/.test(sonra) ? '' : ' '
  const metin = yazi.slice(0, bas) + oneri.ekle + ara + sonra
  return { metin, imlec: bas + oneri.ekle.length + ara.length }
}
