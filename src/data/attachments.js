// Dosya/resim ekleri (010): depoya yükleme (ilerlemeli), imzalı adresler, indirme, ekli gönderme,
// kota, dosya silme ve yetim temizliği. Kurallar veritabanında (supabase/migrations/010_ekler.sql):
// özel "ekler" kovası; okuma yalnız kanal üyelerine / DM taraflarına; yükleme yalnız kendi klasörüne.
import { supabase } from '../lib/supabase.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js'
import { rpcHatasi } from './friends.js'
import { EK_SECIMI } from './sorgular.js'
import { EK_KOVASI, EK_METINLERI, IMZA_SURESI, KOTA, turYasakMi } from './ekKurallari.js'
import { isTauri } from '../desktop.js'

const MAX_UZUNLUK = 2000
const kova = () => supabase.storage.from(EK_KOVASI)

// RPC hatası -> Türkçe metinli Error (err.code: tanınan kod). ozel: konuşmaya özel metinler (DM'de engel).
export function ekHatasi(error, ozel = {}) {
  return rpcHatasi(error, { ...EK_METINLERI, NOT_ALLOWED: 'Mesaj gönderilemedi. Tekrar dene.', ...ozel })
}

// ---------- Yükleme ----------

// Depo yükleme hatası -> Türkçe metinli Error (code: TOO_LARGE / BLOCKED_TYPE / UPLOAD)
function yuklemeHatasi(durum, metin) {
  const m = String(metin ?? '')
  let kod = 'UPLOAD'
  if (durum === 413 || /maximum allowed size|too large|payload too large/i.test(m)) kod = 'TOO_LARGE'
  else if (/mime type|not supported/i.test(m)) kod = 'BLOCKED_TYPE'
  const e = new Error(EK_METINLERI[kod] ?? 'Dosya yüklenemedi. Tekrar dene.')
  e.code = kod
  // Politika reddi (403 / RLS): kota, üyelik ya da engel olabilir; uploadFile kotaya ayrıca bakar
  e.reddedildi = kod === 'UPLOAD' && (durum === 403 || /row-level security|unauthorized/i.test(m))
  return e
}

// Politika reddinde kota doluysa QUOTA metni (depodaki toplam 150 MB'a ulaştıysa yükleme politikası reddeder;
// Storage hatası nedeni söylemez). v0.12 (v08 K-4): kota dolu değilse nedeni yoldan tahmin edilir: yasaklı tür
// ise BLOCKED_TYPE; değilse "izin yok" metni (üyelik düşmüş, DM engeli). Kod UPLOAD kalır.
async function kotaMi(hata, yol, tur) {
  if (!hata?.reddedildi) return hata
  const kullanilan = await kullanimim()
  let kod = 'UPLOAD'
  if (kullanilan != null && kullanilan >= KOTA) kod = 'QUOTA'
  else if (turYasakMi(yol, tur)) kod = 'BLOCKED_TYPE'
  const e = new Error(kod === 'UPLOAD' ? YUKLEME_REDDEDILDI : EK_METINLERI[kod])
  e.code = kod
  return e
}
const YUKLEME_REDDEDILDI = 'Dosya buraya yüklenemedi. Buraya dosya gönderme iznin olmayabilir.'

// Tek dosyayı depoya yükler. onProgress(0..1) yükledikçe çağrılır.
// İlerleme için XMLHttpRequest ile Storage REST adresine yazılır (supabase-js ilerleme vermez).
// XMLHttpRequest yoksa supabase-js ile (ilerlemesiz) yüklenir. Üzerine yazma yok (x-upsert: false).
export async function uploadFile(yol, govde, tur, secenek = {}) {
  try {
    await yukleHam(yol, govde, tur, secenek)
  } catch (e) {
    throw await kotaMi(e, yol, tur)
  }
}

async function yukleHam(yol, govde, tur, { onProgress } = {}) {
  const XHR = globalThis.XMLHttpRequest
  if (!XHR || !SUPABASE_URL) {
    const { error } = await kova().upload(yol, govde, { contentType: tur, upsert: false })
    if (error) throw yuklemeHatasi(error.statusCode ?? error.status, error.message)
    onProgress?.(1)
    return
  }
  const { data } = await supabase.auth.getSession()
  const anahtar = data?.session?.access_token
  const adres = `${SUPABASE_URL}/storage/v1/object/${EK_KOVASI}/${yol.split('/').map(encodeURIComponent).join('/')}`
  await new Promise((tamam, hata) => {
    const x = new XHR()
    x.open('POST', adres)
    if (anahtar) x.setRequestHeader('Authorization', `Bearer ${anahtar}`)
    if (SUPABASE_ANON_KEY) x.setRequestHeader('apikey', SUPABASE_ANON_KEY)
    x.setRequestHeader('Content-Type', tur)
    x.setRequestHeader('x-upsert', 'false')
    x.setRequestHeader('cache-control', 'max-age=3600')
    if (x.upload) {
      x.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total) }
    }
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) { onProgress?.(1); tamam(); return }
      let metin = x.responseText
      try { const j = JSON.parse(x.responseText); metin = j?.message ?? j?.error ?? metin } catch { /* düz metin */ }
      hata(yuklemeHatasi(x.status, metin))
    }
    x.onerror = () => hata(yuklemeHatasi(0, 'network'))
    x.send(govde)
  })
}

// ---------- İmzalı adresler (1 saat; önbellekli) ----------

const adresler = new Map() // anahtar -> { url, bitis (ms) }
const bekleyenler = new Map() // yol -> { promise, tamam, hata } (aynı turda istenenler tek çağrıda)
let topluZamanlayici = null
const YENILEME_PAYI = 60 * 1000 // süresine 1 dakikadan az kalan adres yenilenir

function gecerli(anahtar) {
  const a = adresler.get(anahtar)
  return a && a.bitis - Date.now() > YENILEME_PAYI ? a.url : null
}

// Önbellekte geçerli adres varsa hemen döner (yoksa null): yeniden çizimde resim hemen konur.
export function hazirAdres(yol) { return gecerli(yol) }

// Gösterim adresi (Promise). Aynı turda istenen bütün yollar tek createSignedUrls çağrısında toplanır.
export function adresAl(yol) {
  const hazir = gecerli(yol)
  if (hazir) return Promise.resolve(hazir)
  const var_ = bekleyenler.get(yol)
  if (var_) return var_.promise
  let tamam, hata
  const promise = new Promise((t, h) => { tamam = t; hata = h })
  bekleyenler.set(yol, { promise, tamam, hata })
  if (!topluZamanlayici) topluZamanlayici = setTimeout(topluAl, 0)
  return promise
}

async function topluAl() {
  topluZamanlayici = null
  const isler = [...bekleyenler]
  bekleyenler.clear()
  if (isler.length === 0) return
  try {
    const { data, error } = await kova().createSignedUrls(isler.map(([y]) => y), IMZA_SURESI)
    if (error) throw new Error(error.message)
    const bitis = Date.now() + IMZA_SURESI * 1000
    const gelen = new Map((data ?? []).map((d) => [d.path, d]))
    for (const [yol, is] of isler) {
      const d = gelen.get(yol)
      if (d?.signedUrl) { adresler.set(yol, { url: d.signedUrl, bitis }); is.tamam(d.signedUrl) }
      else is.hata(new Error(d?.error ?? 'Adres alınamadı'))
    }
  } catch (e) {
    for (const [, is] of isler) is.hata(e)
  }
}

// İndirme adresi: Content-Disposition: attachment (dosya adıyla). Önbellekli.
export async function indirmeAdresi(yol, ad) {
  const anahtar = `${yol}\n${ad}`
  const hazir = gecerli(anahtar)
  if (hazir) return hazir
  const { data, error } = await kova().createSignedUrl(yol, IMZA_SURESI, { download: ad || true })
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Adres alınamadı')
  adresler.set(anahtar, { url: data.signedUrl, bitis: Date.now() + IMZA_SURESI * 1000 })
  return data.signedUrl
}

// Eki indirir. Masaüstünde (Tauri) adres opener eklentisiyle varsayılan tarayıcıda açılır (tarayıcı indirir);
// web'de gizli <a download> tıklanır.
export async function indir(ek) {
  const adres = await indirmeAdresi(ek.path, ek.name)
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(adres)
    return
  }
  const a = document.createElement('a')
  a.href = adres
  a.download = ek.name ?? ''
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// (test için) önbelleği sıfırlar
export function resetEkAdresleri() {
  adresler.clear()
  bekleyenler.clear()
  clearTimeout(topluZamanlayici)
  topluZamanlayici = null
}

// ---------- Ekleri getirme ve gönderme ----------

// Verilen mesajların ekleri (canlı gelen mesaj için; ilk yüklemede ekler mesaj sorgusuna gömülü gelir).
// tur: 'channel' | 'dm'. Dönüş: ek satırları + message_id / dm_message_id (id sırasıyla).
export async function fetchAttachments(tur, ids) {
  if (!ids?.length) return []
  const sutun = tur === 'dm' ? 'dm_message_id' : 'message_id'
  const { data, error } = await supabase
    .from('attachments')
    .select(`${EK_SECIMI}, message_id, dm_message_id`)
    .in(sutun, ids)
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

// Ekli mesaj gönderir (mesaj ve ek satırları tek RPC'de). ekler: [{ path, name, mime, width, height }].
// Dönüş: { ok: true, message } | { ok: false, warning } (yazı çok uzunsa gönderilmez). Hata: Türkçe Error.
async function ekliGonder(rpc, kimlik, metin, ekler, replyTo, ozel) {
  const yazi = String(metin ?? '').trim()
  if (yazi.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const { data, error } = await supabase.rpc(rpc, { ...kimlik, metin: yazi, ekler, yanit: replyTo ?? null })
  if (error) throw ekHatasi(error, ozel)
  return { ok: true, message: data }
}

export function sendMessageWithAttachments(channelId, metin, ekler, { replyTo = null } = {}) {
  return ekliGonder('send_message_with_attachments', { cid: channelId }, metin, ekler, replyTo)
}

// DM: engel kodları (BLOCKED_DM / NOT_ALLOWED) ozel ile "Bu kişiye mesaj gönderemezsin." olur (dms.js verir)
export function sendDmWithAttachments(threadId, metin, ekler, { replyTo = null } = {}, ozel = {}) {
  return ekliGonder('send_dm_with_attachments', { tid: threadId }, metin, ekler, replyTo, ozel)
}

// Kullandığım alan (bayt). Bilinemezse null (sunucu yine denetler).
export async function kullanimim() {
  try {
    const { data, error } = await supabase.rpc('ek_kullanimim')
    if (error) return null
    const n = Number(data)
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

// Depodan dosya siler (yalnız kendi klasörüm silinebilir; başkasınınki sessizce kalır, yetim temizliği alır).
export async function removeFiles(yollar) {
  const liste = (yollar ?? []).filter(Boolean)
  if (liste.length === 0) return
  try { await kova().remove(liste) } catch { /* silinemezse yetim temizliği alır */ }
}

// ---------- Yetim temizliği ----------
// Kendi klasörümde olup hiçbir mesaja bağlı olmayan, 1 saatten eski dosyalar (yetim_eklerim) Storage API
// ile silinir (SQL ile silmek dosyayı depoda bırakırdı). Günde en çok bir kez (bu tarayıcıda).
const TEMIZLIK_ANAHTARI = 'voxen.ekTemizligi'
const GUN = 24 * 60 * 60 * 1000

export async function yetimleriTemizle({ simdi = Date.now() } = {}) {
  try {
    const son = Number(localStorage.getItem(TEMIZLIK_ANAHTARI) ?? 0)
    if (simdi - son < GUN) return 0
  } catch { /* depolama kapalıysa yine de dene */ }
  const { data, error } = await supabase.rpc('yetim_eklerim')
  if (error) return 0
  const yollar = (data ?? []).map((x) => (typeof x === 'string' ? x : x?.yetim_eklerim)).filter(Boolean)
  if (yollar.length) {
    const { error: e } = await kova().remove(yollar)
    if (e) return 0
  }
  try { localStorage.setItem(TEMIZLIK_ANAHTARI, String(simdi)) } catch { /* saklanamazsa sonra yine dener */ }
  return yollar.length
}
