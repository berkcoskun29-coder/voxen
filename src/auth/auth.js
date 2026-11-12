// Giriş, kayıt, çıkış ve profil işlemleri. Supabase ile konuşan tek yer burası.
import { supabase } from '../lib/supabase.js'

// Rastgele renk için sabit palet: koyu temada okunaklı 8 renk (tek yerde tanımlı).
export const AVATAR_COLORS = [
  '#5b7cfa', '#3be37a', '#f5a524', '#ef5b9c',
  '#2ec4d6', '#a98bff', '#ff7a59', '#9bd13d',
]

const KULLANICI_ALINMIS = 'Bu kullanıcı adı alınmış'

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
function hataMetni(error) {
  const m = (error?.message ?? '').toLowerCase()
  if (m.includes('invalid login')) return 'E-posta ya da şifre yanlış'
  if (m.includes('already registered')) return 'Bu e-posta zaten kayıtlı'
  if (m.includes('valid email') || m.includes('invalid email')) return 'Geçerli bir e-posta gir'
  if (m.includes('password')) return 'Şifre en az 8 karakter olmalı'
  return 'Bir hata oluştu, tekrar dene'
}

// Profil satırı oluşturur (kayıtta ve "Profilini tamamla" formunda kullanılır).
export async function createProfile(userId, username, color = rastgeleRenk()) {
  const { error } = await supabase.from('profiles').insert({ id: userId, username: username.trim(), color })
  if (error) {
    return { error: error.code === '23505' ? KULLANICI_ALINMIS : hataMetni(error) }
  }
  return { ok: true }
}

export async function signUp(email, password, username) {
  // Önce kendi kontrollerimiz: ağa hiç gitmeden hata ver.
  const adHatasi = validateUsername(username)
  if (adHatasi) return { error: adHatasi }
  if ((password ?? '').length < 8) return { error: 'Şifre en az 8 karakter olmalı' }

  // Kullanıcı oluşmadan ad boş mu bak (anon profilleri okuyamaz, o yüzden RPC).
  const { data: bos } = await supabase.rpc('username_available', { u: username.trim() })
  if (bos === false) return { error: KULLANICI_ALINMIS }

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: hataMetni(error) }

  // Aradaki küçük zamanda biri aynı adı aldıysa createProfile bunu yakalar.
  const sonuc = await createProfile(data.user.id, username)
  // Kullanıcı oluştu ama profil yazılamadı: oturum açık, "Profilini tamamla" ekranına yönlendirilmeli.
  if (sonuc.error) return { error: sonuc.error, needsProfile: true }
  return { user: data.user }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: hataMetni(error) }
  return { user: data.user }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

// Oturum değişince (giriş/çıkış) cb(session) çağrılır.
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_olay, session) => cb(session))
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
