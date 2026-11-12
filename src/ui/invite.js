// Davet linki yardımcıları: #/davet/KOD adresini okur, giriş yapmamışsa kodu saklar.
const ANAHTAR = 'voxen.pendingInvite'

// Adresteki davet kodunu döner (yoksa null).
export function inviteFromHash() {
  const m = location.hash.match(/^#\/davet\/([^/?#]+)/)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null } // bozuk % dizisi (örn. %E0) → geçersiz
}

export function storePendingInvite(code) {
  try { sessionStorage.setItem(ANAHTAR, code) } catch { /* saklanamazsa sorun değil */ }
}

// Saklanan kodu okur ve siler.
export function takePendingInvite() {
  try {
    const code = sessionStorage.getItem(ANAHTAR)
    sessionStorage.removeItem(ANAHTAR)
    return code
  } catch { return null }
}

// Kullanıcının yazdığı/yapıştırdığı metinden davet kodunu çıkarır.
// Kabul: ".../#/davet/KOD" (sonda boşluk/slash olabilir) ya da yalnızca "KOD". Geçersizse null.
export function parseInviteInput(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const link = t.match(/#\/davet\/([^/?#\s]+)/)
  if (link) {
    try { return decodeURIComponent(link[1]) } catch { return null } // bozuk % dizisi → geçersiz
  }
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : null // başka her şey (alakasız URL vb.) geçersiz
}
