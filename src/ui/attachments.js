// Ekler arayüzü (010): resim küçültme, yazı kutusunun üstündeki ek kartları, mesajdaki ekler
// (resim önizlemesi ya da indirme kartı), tam boy resim görüntüleyici ve "Göndermek için bırak" katmanı.
// Bu dosya yalnız DOM kurar; yükleme/gönderme akışını chatView.js yönetir. Kullanıcı metni hep textContent ile.
import { EN_BUYUK_KENAR, WEBP_KALITE, KUCULTULEN_TURLER, resimMi, yalinTur, boyutMetni, dosyaSimgesi } from '../data/ekKurallari.js'
import { hazirAdres, adresAl } from '../data/attachments.js'

// ---------- Resim küçültme ----------

// Uzun kenar sınırı aşıyorsa yeni boyut; aşmıyorsa null
export function kucultmeBoyutu(g, y, sinir = EN_BUYUK_KENAR) {
  if (!(g > 0 && y > 0) || Math.max(g, y) <= sinir) return null
  const oran = sinir / Math.max(g, y)
  return { width: Math.max(1, Math.round(g * oran)), height: Math.max(1, Math.round(y * oran)) }
}

// Tarayıcıda resmi çözer: { kaynak (çizilebilir), width, height, kapat() } | null
async function varsayilanCoz(dosya) {
  try {
    if (typeof createImageBitmap === 'function') {
      const b = await createImageBitmap(dosya)
      return { kaynak: b, width: b.width, height: b.height, kapat: () => b.close?.() }
    }
  } catch { /* aşağıdaki yolu dene */ }
  const adres = globalThis.URL?.createObjectURL?.(dosya)
  if (!adres || typeof Image === 'undefined') return null
  try {
    const img = new Image()
    await new Promise((tamam, hata) => {
      img.onload = tamam
      img.onerror = hata
      setTimeout(hata, 10000) // çözülemeyen resim ekleme akışını kilitlemesin
      img.src = adres
    })
    return { kaynak: img, width: img.naturalWidth, height: img.naturalHeight, kapat: () => URL.revokeObjectURL(adres) }
  } catch {
    URL.revokeObjectURL(adres)
    return null
  }
}

// Çözülmüş resmi yeni boyutta WebP'ye çizer: Blob | null (tarayıcı WebP üretemiyorsa null)
async function varsayilanKucult(cozulmus, boyut) {
  const tuval = document.createElement('canvas')
  tuval.width = boyut.width
  tuval.height = boyut.height
  const ctx = tuval.getContext?.('2d')
  if (!ctx || typeof tuval.toBlob !== 'function') return null
  ctx.drawImage(cozulmus.kaynak, 0, 0, boyut.width, boyut.height)
  const blob = await new Promise((r) => tuval.toBlob(r, 'image/webp', WEBP_KALITE))
  return blob && blob.type === 'image/webp' ? blob : null
}

// Eklenen dosyayı gönderime hazırlar: { blob, name, type, width, height }.
// - Resim değilse olduğu gibi (boyutsuz).
// - JPEG/PNG/WebP uzun kenarı 1920'yi aşıyorsa 1920'ye küçülür, WebP (0.85) olur, adı .webp olur.
// - GIF (ve küçültülemeyen resim) olduğu gibi gider; boyutu bilinirse yazılır.
// arac: { coz, kucult } (test için değiştirilebilir)
export async function resimHazirla(dosya, { coz = varsayilanCoz, kucult = varsayilanKucult } = {}) {
  const tur = yalinTur(dosya.type)
  const ad = dosya.name || 'resim.png'
  const aynen = (g = null, y = null) => ({ blob: dosya, name: ad, type: tur, width: g, height: y })
  if (!resimMi(tur)) return aynen()
  const c = await coz(dosya).catch(() => null)
  if (!c) return aynen()
  try {
    const yeni = KUCULTULEN_TURLER.includes(tur) ? kucultmeBoyutu(c.width, c.height) : null
    if (!yeni) return aynen(c.width || null, c.height || null)
    const blob = await kucult(c, yeni).catch(() => null)
    if (!blob) return aynen(c.width || null, c.height || null)
    const kok = ad.replace(/\.[^./\\]+$/, '') || 'resim'
    return { blob, name: `${kok}.webp`, type: 'image/webp', width: yeni.width, height: yeni.height }
  } finally {
    c.kapat?.()
  }
}

// ---------- Yazı kutusunun üstündeki kartlar ----------

// Kartlar şeridi. ciz(ekler) ile güncellenir; kartlar id ile yeniden kullanılır (odak ve önizleme kaybolmaz).
// ek: { id, ad, boyut, tur, onizleme (blob: adresi | null), durum: 'hazir'|'yukleniyor'|'yuklendi'|'hata', ilerleme (0..1), hata }
// onKaldir(id), onTekrar(). kilitli: gönderim sürerken ✕ pasif.
export function ekTepsisi({ onKaldir, onTekrar } = {}) {
  const el = document.createElement('ul')
  el.className = 'attachment-tray'
  el.setAttribute('aria-label', 'Gönderilecek ekler')
  el.hidden = true
  const kartlar = new Map() // id -> { li, durum, ilerleme, hata, kaldir, tekrar }

  function kartKur(ek) {
    const li = document.createElement('li')
    li.className = 'attachment-card'
    li.dataset.id = String(ek.id)
    let gorsel
    if (ek.onizleme) {
      gorsel = document.createElement('img')
      gorsel.className = 'attachment-card-thumb'
      gorsel.src = ek.onizleme
      gorsel.alt = ''
    } else {
      gorsel = document.createElement('span')
      gorsel.className = 'attachment-card-icon'
      gorsel.setAttribute('aria-hidden', 'true')
      gorsel.textContent = resimMi(ek.tur) ? '🖼️' : dosyaSimgesi(ek.tur, ek.ad)
    }
    const bilgi = document.createElement('div')
    bilgi.className = 'attachment-card-info'
    const ad = document.createElement('span')
    ad.className = 'attachment-card-name'
    ad.textContent = ek.ad
    ad.dataset.tip = ek.ad
    const boyut = document.createElement('span')
    boyut.className = 'attachment-card-size'
    boyut.textContent = boyutMetni(ek.boyut)
    const ilerleme = document.createElement('progress')
    ilerleme.className = 'attachment-card-progress'
    ilerleme.max = 100
    ilerleme.setAttribute('aria-label', `${ek.ad} yükleniyor`)
    const hata = document.createElement('span')
    hata.className = 'attachment-card-error'
    hata.setAttribute('role', 'alert')
    const tekrar = document.createElement('button')
    tekrar.type = 'button'
    tekrar.className = 'secondary attachment-card-retry'
    tekrar.textContent = 'Tekrar dene'
    tekrar.onclick = () => onTekrar?.()
    bilgi.append(ad, boyut, ilerleme, hata, tekrar)
    const kaldir = document.createElement('button')
    kaldir.type = 'button'
    kaldir.className = 'attachment-card-remove'
    kaldir.setAttribute('aria-label', `${ek.ad} ekini kaldır`)
    kaldir.dataset.tip = 'Eki kaldır'
    kaldir.textContent = '✕'
    kaldir.onclick = () => onKaldir?.(ek.id)
    li.append(gorsel, bilgi, kaldir)
    return { li, ilerleme, hata, tekrar, kaldir }
  }

  function ciz(ekler, { kilitli = false } = {}) {
    const varolan = new Set(ekler.map((e) => e.id))
    for (const [id, k] of kartlar) if (!varolan.has(id)) { k.li.remove(); kartlar.delete(id) }
    for (const ek of ekler) {
      let k = kartlar.get(ek.id)
      if (!k) { k = kartKur(ek); kartlar.set(ek.id, k) }
      el.appendChild(k.li) // sırayı korur (var olanı yerinde taşır)
      const yukleniyor = ek.durum === 'yukleniyor'
      const hatali = ek.durum === 'hata'
      k.li.classList.toggle('uploading', yukleniyor)
      k.li.classList.toggle('error', hatali)
      k.ilerleme.hidden = !yukleniyor
      k.ilerleme.value = Math.round((ek.ilerleme ?? 0) * 100)
      k.hata.hidden = !hatali
      k.hata.textContent = hatali ? (ek.hata || 'Yüklenemedi.') : ''
      k.tekrar.hidden = !hatali
      k.kaldir.disabled = kilitli || yukleniyor
    }
    el.hidden = ekler.length === 0
  }

  return { el, ciz }
}

// ---------- Mesajdaki ekler ----------

const ONIZLEME_G = 400
const ONIZLEME_Y = 300

// Önizleme kutusunun boyutu: 400×300'e sığar, oran korunur; boyut bilinmiyorsa null (CSS sınırlar)
export function onizlemeBoyutu(g, y) {
  if (!(g > 0 && y > 0)) return null
  const oran = Math.min(1, ONIZLEME_G / g, ONIZLEME_Y / y)
  return { width: Math.max(1, Math.round(g * oran)), height: Math.max(1, Math.round(y * oran)) }
}

// <img> adresini koyar: önbellekte varsa hemen (yeniden çizimde titremez), yoksa gelince
function adresiKoy(img, yol) {
  const hazir = hazirAdres(yol)
  if (hazir) { img.src = hazir; return }
  adresAl(yol).then((u) => { img.src = u }).catch(() => { img.closest('.att-image')?.classList.add('broken') })
}

// Mesajın ekleri: resimler önizleme düğmesi, diğerleri indirme kartı.
// ekler: [{ path, name, mime, size, width, height }] (sıralı). onAc(resimSirasi), onIndir(ek). Boşsa null.
export function mesajEkleri(ekler, { onAc, onIndir } = {}) {
  if (!ekler?.length) return null
  const kutu = document.createElement('div')
  kutu.className = 'msg-attachments'
  let resimSirasi = 0
  for (const ek of ekler) {
    if (resimMi(ek.mime)) {
      const sira = resimSirasi++
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'att-image'
      b.setAttribute('aria-label', `${ek.name} resmini büyüt`)
      const boyut = onizlemeBoyutu(ek.width, ek.height)
      if (boyut) { b.style.width = boyut.width + 'px'; b.style.height = boyut.height + 'px' }
      const img = document.createElement('img')
      img.alt = ek.name
      img.loading = 'lazy'
      adresiKoy(img, ek.path)
      b.appendChild(img)
      b.onclick = () => onAc?.(sira)
      kutu.appendChild(b)
    } else {
      const kart = document.createElement('div')
      kart.className = 'att-file'
      const simge = document.createElement('span')
      simge.className = 'att-file-icon'
      simge.setAttribute('aria-hidden', 'true')
      simge.textContent = dosyaSimgesi(ek.mime, ek.name)
      const bilgi = document.createElement('div')
      bilgi.className = 'att-file-info'
      const ad = document.createElement('span')
      ad.className = 'att-file-name'
      ad.textContent = ek.name
      const boyut = document.createElement('span')
      boyut.className = 'att-file-size'
      boyut.textContent = boyutMetni(ek.size)
      bilgi.append(ad, boyut)
      const indir = document.createElement('button')
      indir.type = 'button'
      indir.className = 'secondary att-file-download'
      indir.textContent = 'İndir'
      indir.setAttribute('aria-label', `${ek.name} dosyasını indir`)
      indir.onclick = () => onIndir?.(ek)
      kart.append(simge, bilgi, indir)
      kutu.appendChild(kart)
    }
  }
  return kutu
}

// ---------- Tam boy görüntüleyici ----------

let acikGoruntuleyici = null // aynı anda tek görüntüleyici

// Açık görüntüleyiciyi kapatır (sohbet kapanırken; chatView.destroy)
export function goruntuleyiciyiKapat() { acikGoruntuleyici?.kapat(false) }

// resimler: [{ path, name, ... }], baslangic: sıra. onIndir(ek). donusOdagi(): kapanınca odak (varsayılan: açan öğe).
// Koyu katman; ✕ ve Esc kapatır; ← → (ve düğmeleri) aynı mesajdaki resimler arasında geçer; "İndir" düğmesi.
export function goruntuleyiciAc(resimler, baslangic = 0, { onIndir, donusOdagi } = {}) {
  acikGoruntuleyici?.kapat(false)
  if (!resimler?.length) return null
  const onceki = document.activeElement
  let sira = Math.min(Math.max(0, baslangic), resimler.length - 1)

  const arka = document.createElement('div')
  arka.className = 'att-viewer'
  arka.setAttribute('role', 'dialog')
  arka.setAttribute('aria-modal', 'true')
  arka.setAttribute('aria-label', 'Resim görüntüleyici')
  const ust = document.createElement('div')
  ust.className = 'att-viewer-bar'
  const baslik = document.createElement('span')
  baslik.className = 'att-viewer-title'
  baslik.setAttribute('aria-live', 'polite')
  const indir = document.createElement('button')
  indir.type = 'button'
  indir.className = 'secondary att-viewer-download'
  indir.textContent = 'İndir'
  indir.onclick = () => onIndir?.(resimler[sira])
  const kapatDugmesi = document.createElement('button')
  kapatDugmesi.type = 'button'
  kapatDugmesi.className = 'att-viewer-close'
  kapatDugmesi.setAttribute('aria-label', 'Kapat')
  kapatDugmesi.dataset.tip = 'Kapat (Esc)'
  kapatDugmesi.textContent = '✕'
  kapatDugmesi.onclick = () => kapat(true)
  ust.append(baslik, indir, kapatDugmesi)

  const sahne = document.createElement('div')
  sahne.className = 'att-viewer-stage'
  const img = document.createElement('img')
  img.className = 'att-viewer-img'
  const gezinme = (yon, yazi, simge) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `att-viewer-nav att-viewer-${yon}`
    b.setAttribute('aria-label', yazi)
    b.textContent = simge
    return b
  }
  const geri = gezinme('prev', 'Önceki resim', '←')
  const ileri = gezinme('next', 'Sonraki resim', '→')
  geri.onclick = () => git(sira - 1)
  ileri.onclick = () => git(sira + 1)
  if (resimler.length > 1) sahne.append(geri, img, ileri)
  else sahne.append(img)
  arka.append(ust, sahne)
  document.body.appendChild(arka)

  function goster() {
    const ek = resimler[sira]
    img.alt = ek.name
    img.removeAttribute('src')
    adresiKoy(img, ek.path)
    baslik.textContent = resimler.length > 1 ? `${ek.name} (${sira + 1} / ${resimler.length})` : ek.name
  }
  function git(n) {
    if (resimler.length < 2) return
    sira = (n + resimler.length) % resimler.length
    goster()
  }

  const odaklanabilenler = () => [...arka.querySelectorAll('button')].filter((b) => !b.disabled)
  arka.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kapat(true) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); git(sira - 1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); git(sira + 1) }
    else if (e.key === 'Tab') {
      // Odak katmanın içinde döner
      const l = odaklanabilenler()
      const i = l.indexOf(document.activeElement)
      e.preventDefault()
      l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length]?.focus()
    }
  })
  // Koyu alana (resmin dışına) tıklamak kapatır
  arka.addEventListener('click', (e) => { if (e.target === arka || e.target === sahne) kapat(true) })

  let kapandi = false
  function kapat(odakVer) {
    if (kapandi) return
    kapandi = true
    arka.remove()
    if (acikGoruntuleyici === kayit) acikGoruntuleyici = null
    if (odakVer) {
      const hedef = donusOdagi?.() ?? onceki
      if (hedef?.isConnected) hedef.focus?.()
    }
  }
  const kayit = { el: arka, kapat, git, sira: () => sira }
  acikGoruntuleyici = kayit
  goster()
  kapatDugmesi.focus()
  return kayit
}

// ---------- Sürükle-bırak katmanı ----------

export function birakmaKatmani() {
  const el = document.createElement('div')
  el.className = 'drop-overlay'
  el.hidden = true
  el.setAttribute('aria-hidden', 'true')
  const yazi = document.createElement('div')
  yazi.className = 'drop-overlay-text'
  yazi.textContent = 'Göndermek için bırak'
  el.appendChild(yazi)
  return el
}
