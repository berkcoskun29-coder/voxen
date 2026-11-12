// Avatar baş harfinin rengi: arka plan rengine göre okunaklı olanı seçilir (WCAG 4.5:1 hedefi).
// Sabit eşleme paletin her rengi için, hesap ise eski profillerdeki bilinmeyen renkler için.

const KOYU = '#0f1a14' // açık zemin üstünde (temanın "yeşil üstü koyu yazı" rengi)
const BEYAZ = '#ffffff' // koyu zemin üstünde

// Palet rengi -> harf rengi. (Paletteki 8 rengin hepsi açık/orta tonlu: koyu harf hepsinde
// en az 4.8:1 verir, beyaz harf ise en iyi 3.7:1.) Yeni palet rengi eklenirse buraya da eklenir.
export const AVATAR_TEXT_COLORS = {
  '#5b7cfa': KOYU,
  '#3be37a': KOYU,
  '#f5a524': KOYU,
  '#ef5b9c': KOYU,
  '#2ec4d6': KOYU,
  '#a98bff': KOYU,
  '#ff7a59': KOYU,
  '#9bd13d': KOYU,
}

// "#rgb" ya da "#rrggbb" -> [r, g, b] (0-255); okunamazsa null
function rgbOku(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

// WCAG göreli parlaklık (0 siyah ... 1 beyaz)
function parlaklik([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

// İki renk arasındaki kontrast oranı (1 ile 21 arası)
export function contrastRatio(a, b) {
  const x = parlaklik(rgbOku(a)), y = parlaklik(rgbOku(b))
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Verilen arka plan rengi için harf rengi.
export function avatarTextColor(bg) {
  const anahtar = String(bg ?? '').trim().toLowerCase()
  if (AVATAR_TEXT_COLORS[anahtar]) return AVATAR_TEXT_COLORS[anahtar]
  if (!rgbOku(anahtar)) return BEYAZ // okunamayan renk: eski varsayılan
  // Bilinmeyen renk: iki seçenekten kontrastı yüksek olan
  return contrastRatio(anahtar, KOYU) >= contrastRatio(anahtar, BEYAZ) ? KOYU : BEYAZ
}
