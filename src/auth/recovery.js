// "Şifremi unuttum" dönüşü.
//
// Akış:
//   1. Kullanıcı e-postasını yazar → Supabase sıfırlama linki gönderir (auth.js: requestPasswordReset).
//      Linkin döneceği adres: resetRedirectUrl() → ".../" (hash yok).
//   2. Linke tıklanınca Supabase kütüphanesi oturumu kendisi kurar ve PASSWORD_RECOVERY olayını gönderir.
//   3. main.js bu olayda markRecoveryPending() çağırır; mod işaretliyse uygulamayı açmaz, yeni şifre formunu gösterir.
//   4. Yeni şifre kaydedilince (ya da çıkış yapılınca) mod temizlenir (clearRecoveryPending).
//
// Mod localStorage'da tutulur: Supabase oturumu da orada durur, sekme kapanıp açılsa bile
// yeni şifre formu çıkar, uygulamaya sessizce geçilmez.
import { PUBLIC_URL } from '../config.js'

const ANAHTAR = 'voxen.sifreYenile'
const LINK_GECERSIZ = 'Bu bağlantının süresi dolmuş ya da geçersiz. Yeni bir bağlantı iste.'

let linkHatasi = null // süresi dolmuş linkten dönüldüyse gösterilecek metin (bir kez okunur)

// Sıfırlama linkinin döneceği adres.
// Geliştirmede (npm run dev) sayfanın kendi adresi (localhost:5173), yayında PUBLIC_URL
// (masaüstü programında PUBLIC_URL yoksa yine sayfanın adresi). Sonu tek "/" ile biter, hash eklenmez.
export function resetRedirectUrl({
  dev = import.meta.env.DEV,
  publicUrl = PUBLIC_URL,
  origin = typeof location !== 'undefined' ? location.origin : '',
} = {}) {
  const taban = (dev ? origin : (publicUrl || origin)).replace(/\/+$/, '')
  return `${taban}/`
}

// Sayfa açılırken adresi kontrol eder (src/lib/supabase.js, istemciyi kurmadan önce çağırır).
export function captureRecoveryFromUrl() {
  if (typeof location === 'undefined') return // tarayıcı dışı (testler, node)
  // Link geçersiz/süresi dolmuşsa Supabase adresi "#error=...&error_code=otp_expired" yapar
  if (/[#&]error_code=/.test(location.hash)) {
    linkHatasi = LINK_GECERSIZ
    history.replaceState(history.state, '', location.pathname + location.search) // hata adreste kalmasın
  }
}

// Süresi dolmuş link metni (yoksa null). Bir kez döner.
export function takeRecoveryLinkError() {
  const m = linkHatasi
  linkHatasi = null
  return m
}

export function markRecoveryPending() {
  try { localStorage.setItem(ANAHTAR, String(Date.now())) } catch { /* saklanamazsa yalnız olay yeter */ }
}

export function clearRecoveryPending() {
  try { localStorage.removeItem(ANAHTAR) } catch { /* yok say */ }
}

// İşaret bir saatten eskiyse (sekme kapatıldı, şifre belirlenmedi) eski sayılır, silinir ve yok sayılır.
// Eski sürümün yazdığı '1' değeri zamansız ama geçerli kabul edilir.
const ISARET_OMRU = 60 * 60 * 1000
export function isRecoveryPending(simdi = Date.now()) {
  try {
    const v = localStorage.getItem(ANAHTAR)
    if (!v) return false
    if (v === '1') return true
    const t = Number(v)
    if (!Number.isFinite(t) || simdi - t > ISARET_OMRU) { localStorage.removeItem(ANAHTAR); return false }
    return true
  } catch { return false }
}
