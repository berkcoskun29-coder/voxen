// Giriş, kayıt, çıkış ve profil işlemleri. Supabase ile konuşan tek yer burası.
import { supabase } from '../lib/supabase.js'
import { resetRedirectUrl } from './recovery.js'

// (Her palet rengi için baş harf rengi: src/ui/avatarColor.js)
// Rastgele renk için sabit palet: koyu temada okunaklı 8 renk (tek yerde tanımlı).
export const AVATAR_COLORS = [
  '#5b7cfa', '#3be37a', '#f5a524', '#ef5b9c',
  '#2ec4d6', '#a98bff', '#ff7a59', '#9bd13d',
]

export const KULLANICI_ALINMIS = 'Bu kullanıcı adı alınmış'
const COK_DENEME = 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.'
const GENEL_HATA = 'Bir şeyler ters gitti. İnternetini kontrol edip tekrar dene.'
const KISA_SIFRE = 'Şifre en az 8 karakter olmalı'
const ZAYIF_SIFRE = 'Bu şifre çok zayıf. Daha uzun bir şifre seç; harf, rakam ve işaret karıştır.'

export function rastgeleRenk() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
}

// Kullanıcı adı kuralı: 3-20 karakter. Hata varsa Türkçe metin, yoksa null.
export function validateUsername(username) {
  const u = (username ?? '').trim()
  if (u.length < 3) return 'Kullanıcı adı en az 3 karakter olmalı'
  if (u.length > 20) return 'Kullanıcı adı en fazla 20 karakter olabilir'
  return null
}

// Supabase'in İngilizce hatalarını Türkçeye çevirir.
// { error: metin, alan: hangi kutuyla ilgili } döner; alan yoksa hata genel bir hatadır.
// Metinler çözümü de söyler. Girişte hangi kutunun yanlış olduğu bilinmez, hata şifre kutusuna yazılır.
// Supabase hız sınırı (429): çok sık giriş denemesi ya da e-posta isteği
function hizSiniri(error) {
  const m = (error?.message ?? '').toLowerCase()
  return error?.status === 429 || String(error?.code ?? '').startsWith('over_') ||
    m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')
}

function hataBilgi(error) {
  const m = (error?.message ?? '').toLowerCase()
  if (hizSiniri(error)) return { error: COK_DENEME }
  if (m.includes('invalid login')) return { error: 'E-posta ya da şifre yanlış. Kontrol edip tekrar dene.', alan: 'password' }
  if (m.includes('already registered')) return { error: 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.', alan: 'email' }
  if (m.includes('valid email') || m.includes('invalid email')) return { error: 'Geçerli bir e-posta gir', alan: 'email' }
  if (error?.code === 'weak_password' || m.includes('weak')) return { error: ZAYIF_SIFRE, alan: 'password' }
  if (m.includes('password')) return { error: 'Şifre kabul edilmedi. Başka bir şifre dene.', alan: 'password' }
  return { error: GENEL_HATA }
}
const hataMetni = (error) => hataBilgi(error).error
// Kullanıcı adı çakışması (unique ihlali) kullanıcı adı kutusuyla ilgilidir
const adAlinmis = () => ({ error: KULLANICI_ALINMIS, alan: 'username' })

// Profil satırı oluşturur (kayıtta ve "Profilini tamamla" formunda kullanılır).
export async function createProfile(userId, username, color = rastgeleRenk()) {
  const { error } = await supabase.from('profiles').insert({ id: userId, username: username.trim(), color })
  if (error) {
    return error.code === '23505' ? adAlinmis() : hataBilgi(error)
  }
  return { ok: true }
}

export async function signUp(email, password, username) {
  // Önce kendi kontrollerimiz: ağa hiç gitmeden hata ver.
  const adHatasi = validateUsername(username)
  if (adHatasi) return { error: adHatasi, alan: 'username' }
  if ((password ?? '').length < 8) return { error: KISA_SIFRE, alan: 'password' }

  // Kullanıcı oluşmadan ad boş mu bak (anon profilleri okuyamaz, o yüzden RPC).
  const { data: bos } = await supabase.rpc('username_available', { u: username.trim() })
  if (bos === false) return adAlinmis()

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return hataBilgi(error)

  // Aradaki küçük zamanda biri aynı adı aldıysa createProfile bunu yakalar.
  const sonuc = await createProfile(data.user.id, username)
  // Kullanıcı oluştu ama profil yazılamadı: oturum açık, "Profilini tamamla" ekranına yönlendirilmeli.
  if (sonuc.error) return { error: sonuc.error, alan: sonuc.alan, needsProfile: true }
  return { user: data.user }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return hataBilgi(error)
  return { user: data.user }
}

// "Şifremi unuttum": e-postaya sıfırlama linki gönderir. Link uygulamayı açar, Supabase PASSWORD_RECOVERY olayını gönderir (recovery.js).
// Supabase, e-posta kayıtlı olmasa da hata vermez; ekranda her durumda aynı (tarafsız) metin gösterilir.
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() })
  if (!error) return { ok: true }
  const m = (error.message ?? '').toLowerCase()
  if (hizSiniri(error)) return { error: COK_DENEME }
  // Gönderim başarısız (sunucu hatası / SMTP): adres doğru olabilir, kullanıcıyı yanıltma
  if ((error.status ?? 0) >= 500 || m.includes('sending') || error.code === 'unexpected_failure') {
    return { error: 'E-posta gönderilemedi. Birkaç dakika sonra tekrar dene.' }
  }
  // Yalnız gerçekten geçersiz adres hatalarında e-posta kutusu işaretlenir
  if (error.code === 'validation_failed' || m.includes('invalid') || m.includes('validate email')) {
    return { error: 'Geçerli bir e-posta gir', alan: 'email' }
  }
  return { error: GENEL_HATA }
}

// Sıfırlama linkinden dönen kullanıcının yeni şifresini kaydeder.
export async function updatePassword(password) {
  if ((password ?? '').length < 8) return { error: KISA_SIFRE, alan: 'password' } // ağa gitmeden
  const { error } = await supabase.auth.updateUser({ password })
  if (!error) return { ok: true }
  const m = (error.message ?? '').toLowerCase()
  const kod = error.code ?? ''
  if (hizSiniri(error)) return { error: COK_DENEME }
  if (kod === 'same_password' || m.includes('different from the old')) {
    return { error: 'Yeni şifre eskisiyle aynı olamaz. Başka bir şifre seç.', alan: 'password' }
  }
  if (kod === 'weak_password' || m.includes('weak')) {
    return { error: ZAYIF_SIFRE, alan: 'password' }
  }
  // Linkin oturumu bitmiş (süre doldu ya da başka sekmede çıkış yapıldı)
  if (kod.startsWith('session_') || m.includes('session missing') || m.includes('expired')) {
    return { error: 'Sıfırlama linkinin süresi doldu. "Şifremi unuttum" ile yeni link iste.' }
  }
  return { error: GENEL_HATA }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

// Oturum değişince (giriş/çıkış) cb(session, olay) çağrılır.
// olay: Supabase olay adı (örn. 'SIGNED_OUT', 'PASSWORD_RECOVERY': sıfırlama linkinden dönüldü)
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((olay, session) => cb(session, olay))
}

// Giriş yapmış kullanıcının profili; yoksa null.
export async function getMyProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  return data ?? null
}

// Kullanıcı adı ve renk gibi alanları günceller.
export async function updateProfile(userId, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId)
  if (error) return { error: error.code === '23505' ? KULLANICI_ALINMIS : hataMetni(error) }
  return { ok: true }
}

// Resmi en fazla 256x256'ya küçültüp webp'e çevirir.
async function resmiKucult(file) {
  const bmp = await createImageBitmap(file)
  const oran = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * oran)
  canvas.height = Math.round(bmp.height * oran)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Resim dönüştürülemedi'))), 'image/webp', 0.85)
  })
}

// Profil resmini yükler, adresini profile kaydeder ve adresi döner.
export async function uploadAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('Lütfen bir resim dosyası seç')
  if (file.size > 1024 * 1024) throw new Error('Resim en fazla 1 MB olabilir')

  const session = await getSession()
  if (!session) throw new Error('Önce giriş yapmalısın')
  const userId = session.user.id

  const blob = await resmiKucult(file)
  const yol = `${userId}.webp`
  const { error } = await supabase.storage.from('avatars').upload(yol, blob, {
    upsert: true,
    contentType: 'image/webp',
  })
  if (error) throw new Error('Resim yüklenemedi, tekrar dene')

  // ?v=... tarayıcı eski resmi önbellekten göstermesin diye
  const { data } = supabase.storage.from('avatars').getPublicUrl(yol)
  const url = `${data.publicUrl}?v=${Date.now()}`
  const sonuc = await updateProfile(userId, { avatar_url: url })
  if (sonuc.error) throw new Error(sonuc.error)
  return url
}
