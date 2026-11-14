// Okunmamış rozeti (v0.13.0): pencere başlığının yanında, uygulamanın simgesinde küçük kırmızı nokta.
// Tarayıcıda favicon noktalı sürümüyle (public/favicon-okunmamis.svg) değişir. Masaüstünde (Windows) görev
// çubuğu simgesine bindirme (overlay) simgesi konur: Tauri 2'de setBadgeCount Windows'ta yok, setOverlayIcon var.
// Simge burada çizilen 16x16 RGBA noktadır (Image.new; Cargo'da image-png özelliği gerekmez).
// İzin: capabilities/default.json "core:window:allow-set-overlay-icon".
import { isTauri } from './desktop.js'

export const FAVICON = '/favicon.svg'
export const FAVICON_OKUNMAMIS = '/favicon-okunmamis.svg'

// Kırmızı dolu daire (kenarı yumuşak), RGBA satır satır. Renk tema değişkeni okuyamaz: --danger ile aynı ton.
export function kirmiziNokta(boyut = 16) {
  const p = new Uint8Array(boyut * boyut * 4)
  const m = (boyut - 1) / 2
  const r = boyut / 2 - 0.5
  for (let y = 0; y < boyut; y++) {
    for (let x = 0; x < boyut; x++) {
      const d = Math.hypot(x - m, y - m)
      const a = Math.max(0, Math.min(1, r - d + 0.5)) // kenarda yarı saydam
      const i = (y * boyut + x) * 4
      p[i] = 0xef; p[i + 1] = 0x5b; p[i + 2] = 0x5b; p[i + 3] = Math.round(a * 255)
    }
  }
  return p
}

let sonDurum = null // son uygulanan: true (nokta var) | false | null (henüz yok)
let sira = Promise.resolve() // masaüstü çağrıları sırayla gitsin (hızlı aç/kapa karışmasın)

// sayi > 0 ise nokta konur, değilse kalkar. Durum değişmediyse bir şey yapılmaz.
export function setUnreadBadge(sayi) {
  const var_ = sayi > 0
  if (var_ === sonDurum) return
  sonDurum = var_
  if (isTauri()) {
    sira = sira.then(() => bindirme(var_)).catch(() => { /* rozet konamazsa uygulama bozulmasın */ })
    return
  }
  if (typeof document === 'undefined') return
  const link = document.querySelector('link[rel~="icon"]')
  link?.setAttribute('href', var_ ? FAVICON_OKUNMAMIS : FAVICON)
}

async function bindirme(var_) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  if (!var_) { await getCurrentWindow().setOverlayIcon(undefined); return }
  const { Image } = await import('@tauri-apps/api/image')
  const simge = await Image.new(kirmiziNokta(16), 16, 16)
  await getCurrentWindow().setOverlayIcon(simge)
}

// (test ve çıkış için) son durumu unutur: sonraki çağrı mutlaka uygulanır
export function resetBadge() {
  sonDurum = null
  sira = Promise.resolve()
}
