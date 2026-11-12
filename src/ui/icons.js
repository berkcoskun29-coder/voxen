// Küçük SVG simgeler (satır içi; simge yazı tipi ya da dış dosya yok).
// kapali = true: üstü çizili ve kırmızı (#e05b5b). Renk kapalı değilse yazı rengini (currentColor) alır.
const NS = 'http://www.w3.org/2000/svg'
const KIRMIZI = '#e05b5b'

function svgKur(kapali, cizimler, boyut = 16) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(boyut))
  svg.setAttribute('height', String(boyut))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', kapali ? KIRMIZI : 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('icon')
  if (kapali) svg.classList.add('crossed')
  for (const [tag, ozellikler] of cizimler) {
    const e = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(ozellikler)) e.setAttribute(k, v)
    svg.appendChild(e)
  }
  if (kapali) {
    // Çapraz çizgi
    const cizgi = document.createElementNS(NS, 'line')
    for (const [k, v] of Object.entries({ x1: 3, y1: 3, x2: 21, y2: 21 })) cizgi.setAttribute(k, v)
    svg.appendChild(cizgi)
  }
  return svg
}

export function micIcon(kapali = false, boyut = 16) {
  return svgKur(kapali, [
    ['rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }],
    ['path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v4' }],
  ], boyut)
}

export function headphonesIcon(kapali = false, boyut = 16) {
  return svgKur(kapali, [
    ['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }],
    ['rect', { x: 3, y: 14, width: 4, height: 7, rx: 2 }],
    ['rect', { x: 17, y: 14, width: 4, height: 7, rx: 2 }],
  ], boyut)
}

// Sesli kanaldaki biri için: sağırsa kulaklık (üstü çizili), sadece susturulmuşsa mikrofon (üstü çizili).
// Hiçbiri değilse null. Sağırlaştırma susturmanın yerine geçer.
export function voiceStateIcon(muted, deafened) {
  if (deafened) {
    const i = headphonesIcon(true)
    i.dataset.state = 'deafened'
    return i
  }
  if (muted) {
    const i = micIcon(true)
    i.dataset.state = 'muted'
    return i
  }
  return null
}

// Kamera simgesi. kapali = true: üstü çizili ve kırmızı.
export function cameraIcon(kapali = false, boyut = 16) {
  return svgKur(kapali, [
    ['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }],
    ['path', { d: 'M16 10l6-3v10l-6-3z' }],
  ], boyut)
}

// Ekran (monitör) simgesi
export function screenIcon(boyut = 16) {
  return svgKur(false, [
    ['rect', { x: 2, y: 4, width: 20, height: 13, rx: 2 }],
    ['path', { d: 'M8 21h8M12 17v4' }],
  ], boyut)
}

// --- Sunucu şeridi, kullanıcı çubuğu ve ses paneli simgeleri (hepsi 2 kalınlığında çizgi) ---

// Artı: "Sunucu oluştur"
export function plusIcon(boyut = 22) {
  return svgKur(false, [['path', { d: 'M12 5v14M5 12h14' }]], boyut)
}

// Bağlantı (zincir): "Sunucuya katıl"
export function linkIcon(boyut = 22) {
  return svgKur(false, [
    ['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }],
  ], boyut)
}

// Ayarlar dişlisi
export function gearIcon(boyut = 18) {
  return svgKur(false, [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }],
  ], boyut)
}

// İki kişi: "Üyeler" (sohbet başlığındaki üye paneli düğmesi)
export function usersIcon(boyut = 20) {
  return svgKur(false, [
    ['circle', { cx: 9, cy: 8, r: 3.5 }],
    ['path', { d: 'M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5' }],
  ], boyut)
}

// Telefon kapatma: "Ayrıl"
export function hangupIcon(boyut = 18) {
  return svgKur(false, [['path', { d: 'M3 15c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z' }]], boyut)
}

// Hoparlör: "Sesli kanal" (kanal ekle penceresindeki tür kartı ve ad kutusu)
export function speakerIcon(boyut = 18) {
  return svgKur(false, [
    ['path', { d: 'M4 9h4l5-4v14l-5-4H4z' }],
    ['path', { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' }],
  ], boyut)
}

// Göz: "Şifreyi göster". acik = false iken üstü çizili göz (şifre görünürken "gizle" anlamında)
export function eyeIcon(acik = true, boyut = 18) {
  const cizimler = [
    ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ]
  // Üstü çizili göz kırmızı olmasın (svgKur'un "kapalı" hâli kırmızıdır): çizgiyi kendimiz ekleriz
  if (!acik) cizimler.push(['path', { d: 'M3 3l18 18' }])
  return svgKur(false, cizimler, boyut)
}
