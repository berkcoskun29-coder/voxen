// Küçük SVG simgeler (satır içi; simge yazı tipi ya da dış dosya yok).
// kapali = true: üstü çizili ve kırmızı (#e05b5b). Renk kapalı değilse yazı rengini (currentColor) alır.
const NS = 'http://www.w3.org/2000/svg'
const KIRMIZI = '#e05b5b'

function svgKur(kapali, cizimler) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
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

export function micIcon(kapali = false) {
  return svgKur(kapali, [
    ['rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }],
    ['path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v4' }],
  ])
}

export function headphonesIcon(kapali = false) {
  return svgKur(kapali, [
    ['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }],
    ['rect', { x: 3, y: 14, width: 4, height: 7, rx: 2 }],
    ['rect', { x: 17, y: 14, width: 4, height: 7, rx: 2 }],
  ])
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
