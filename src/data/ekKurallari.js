// Dosya/resim ekleri için ortak kurallar (supabase/migrations/010_ekler.sql ile AYNI olmalı;
// tests/schema010.test.js listelerin eşitliğini denetler). Bu dosya hiçbir şey içe aktarmaz:
// doğrulama betiği (tasarim/_araclar/dogrula-010.mjs) de Node'da doğrudan kullanır.

export const EK_KOVASI = 'ekler'
export const EN_FAZLA_EK = 4
export const DOSYA_SINIRI = 8 * 1024 * 1024 // dosya başı 8 MB
export const KOTA = 150 * 1024 * 1024 // kişi başı toplam 150 MB
export const IMZA_SURESI = 3600 // imzalı adres 1 saat geçerli (saniye)

// Resim küçültme: uzun kenar 1920 px'ten büyükse küçültülür ve WebP olur (GIF olduğu gibi gider)
export const EN_BUYUK_KENAR = 1920
export const WEBP_KALITE = 0.85
export const KUCULTULEN_TURLER = ['image/jpeg', 'image/png', 'image/webp']

// Mesajda resim olarak gösterilen türler. Bunlar depoya kendi türüyle yüklenir; diğer HER dosya
// 'application/octet-stream' olarak yüklenir (kova yalnız bu beş türü kabul eder: imzalı adresten
// hiçbir dosya HTML ya da betik olarak sunulamaz).
export const RESIM_TURLERI = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const DEPO_TURLERI = [...RESIM_TURLERI, 'application/octet-stream']

// Yasaklı türler: çalıştırılabilir ve betik dosyaları
export const YASAK_UZANTILAR = ['exe', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'js', 'vbs', 'scr', 'jar', 'html', 'htm', 'svg']
export const YASAK_MIMELER = [
  'application/x-msdownload',
  'application/x-msi',
  'application/x-ms-installer',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/vnd.microsoft.portable-executable',
  'application/x-bat',
  'application/x-sh',
  'application/x-shellscript',
  'text/x-shellscript',
  'application/x-powershell',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/javascript',
  'text/ecmascript',
  'text/vbscript',
  'application/x-vbscript',
  'application/java-archive',
  'application/x-java-archive',
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
]

// Yazısız ekli mesajın içeriği (veritabanındaki içerik kısıtı 1–2000 karakter ister; eski istemci
// boş balon yerine bunu görür). Yeni istemci ekleri olan mesajda bu yazıyı göstermez.
export const YER_TUTUCU = '📎 dosya'

export const EK_METINLERI = {
  TOO_LARGE: 'Dosya çok büyük (en fazla 8 MB).',
  QUOTA: 'Depolama sınırına ulaştın. Eski eklerini silerek yer açabilirsin.',
  BLOCKED_TYPE: 'Bu dosya türü gönderilemez.',
  TOO_MANY: 'Bir mesajda en fazla 4 ek olabilir.',
  REPLY_GONE: 'Yanıtladığın mesaj silinmiş.',
  BAD_ATTACHMENT: 'Ek gönderilemedi. Tekrar dene.',
}

// Dosya adının uzantısı (küçük harf, noktasız); yoksa ''. Sondaki nokta ve boşluklar önce kırpılır:
// Windows ve tarayıcı "virus.exe." adını "virus.exe" olarak kaydeder (010'daki ek_uzanti ile aynı).
export function uzanti(ad) {
  const m = /\.([^./\\]+)$/.exec(String(ad ?? '').replace(/[.\s]+$/, ''))
  return m ? m[1].toLowerCase() : ''
}

// Adda kontrol ya da görünmez biçim karakteri var mı (U+202E sağdan sola, U+200B…)? Varsa ad yasaklıdır:
// "fdp.exe" gibi görünüp başka uzantı taşıyabilir (010'daki ek_adi_gizli_karakterli).
export function gizliKarakterVar(ad) {
  return /[\p{Cc}\p{Cf}]/u.test(String(ad ?? ''))
}

// MIME'nin yalın hâli: "Text/HTML; charset=utf-8" -> "text/html"
export function yalinTur(mime) {
  return String(mime ?? '').split(';')[0].trim().toLowerCase()
}

// Yasaklı tür mü: gizli karakterli ad, uzantı YA DA MIME'ye göre
export function turYasakMi(ad, mime) {
  return gizliKarakterVar(ad) || YASAK_UZANTILAR.includes(uzanti(ad)) || YASAK_MIMELER.includes(yalinTur(mime))
}

export const resimMi = (mime) => RESIM_TURLERI.includes(yalinTur(mime))

// Depoya hangi türle yüklenir: resim kendi türüyle, gerisi octet-stream (yalnız indirilir)
export const depoTuru = (mime) => (resimMi(mime) ? yalinTur(mime) : 'application/octet-stream')

// Yoldaki güvenli ad: Türkçe harfler sadeleşir, kalan her şey "_" olur; en çok 80 karakter (uzantı korunur).
// Asıl ad attachments.name'de durur; bu yalnız depo anahtarı içindir.
export function guvenliAd(ad) {
  const harita = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' }
  let s = Array.from(String(ad ?? '')).map((c) => harita[c] ?? c).join('')
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '')
  if (!s) s = 'dosya'
  if (s.length > 80) {
    const u = uzanti(s)
    const son = u ? '.' + u.slice(0, 10) : ''
    s = s.slice(0, 80 - son.length) + son
  }
  return s
}

// Deponun yolu: k/<kanal>/<kişi>/<uuid>-<ad> ya da d/<konuşma>/<kişi>/<uuid>-<ad>
// klasor: 'k/<kanal>' ya da 'd/<konuşma>' (kaynak.ekKlasoru)
export function ekYolu(klasor, uid, uuid, ad) {
  return `${klasor}/${uid}/${uuid}-${guvenliAd(ad)}`
}

// Boyut metni: "512 B", "12 KB", "1,2 MB"
export function boyutMetni(bayt) {
  const n = Number(bayt) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`
}

// Eklenen dosyanın istemci denetimi: hata metni ya da null. boyut: küçültmeden SONRAKİ boyut.
export function ekDenetle(ad, mime, boyut) {
  if (turYasakMi(ad, mime)) return EK_METINLERI.BLOCKED_TYPE
  if (Number(boyut) > DOSYA_SINIRI) return EK_METINLERI.TOO_LARGE
  return null
}

// Dosya simgesi (resim olmayan ekler için)
export function dosyaSimgesi(mime, ad) {
  const t = yalinTur(mime)
  const u = uzanti(ad)
  if (t.startsWith('audio/')) return '🎵'
  if (t.startsWith('video/')) return '🎬'
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(u) || /zip|rar|7z|tar|gzip/.test(t)) return '🗜️'
  return '📄'
}
