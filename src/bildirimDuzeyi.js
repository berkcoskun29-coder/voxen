// Bildirim düzeyi kuralları (v0.13.0). Saf fonksiyonlar: veritabanına ya da ekrana dokunmaz.
// Düzeyler: 'all' (Tüm mesajlar), 'mentions' (Yalnız @bahsetmeler, varsayılan), 'none' (Hiçbiri).
// Kanalda düzey null ise sunucunun düzeyi geçerlidir ("Sunucu varsayılanı").
// Kanal ayarı (src/data/notifyPrefs.js): { level, muted, mutedUntil } — mutedUntil null ise "ben açana kadar".

export const VARSAYILAN_DUZEY = 'mentions'
export const DUZEYLER = ['all', 'mentions', 'none']
export const DUZEY_YAZILARI = { all: 'Tüm mesajlar', mentions: 'Yalnız @bahsetmeler', none: 'Hiçbiri' }

// Kanalı sessize alma süreleri (saat; null = ben açana kadar)
export const SESSIZ_SURELERI = [
  { yazi: '1 saat', saat: 1 },
  { yazi: '8 saat', saat: 8 },
  { yazi: '24 saat', saat: 24 },
  { yazi: 'Ben açana kadar', saat: null },
]

// Kanaldaki geçerli düzey: kanalın kendi düzeyi, yoksa sunucununki, o da yoksa varsayılan
export function etkinDuzey(sunucuDuzeyi, kanalAyari) {
  return kanalAyari?.level ?? sunucuDuzeyi ?? VARSAYILAN_DUZEY
}

// Kanal şu an sessizde mi? Süresi dolan sessizlik kendiliğinden kalkmış sayılır (sunucuda iş yok).
export function kanalSessizMi(kanalAyari, simdi = Date.now()) {
  if (!kanalAyari?.muted) return false
  if (kanalAyari.mutedUntil == null) return true
  const bitis = Date.parse(kanalAyari.mutedUntil)
  return Number.isFinite(bitis) && bitis > simdi
}

// Sunucu kanalındaki yeni mesaj bildirim verir mi? Dönen:
//   null: vermez · 'mention': beni anıyor · 'everyone': @herkes (yazarın izni ayrıca denetlenmeli) · 'all': her mesaj
// Sıra: sunucu sessizde -> hiç; kanal sessizde -> yalnız beni doğrudan anan; 'none' -> hiç;
// 'mentions' -> anma ya da @herkes; 'all' -> her mesaj. (Odak, "Rahatsız etmeyin" vb. shouldNotify'da.)
export function kanalBildirimKarari({ duzey, kanalSessiz, sunucuSessiz, anar, herkes }) {
  if (sunucuSessiz) return null
  if (kanalSessiz) return anar ? 'mention' : null
  if (duzey === 'none') return null
  if (anar) return 'mention'
  if (duzey === 'all') return 'all'
  return herkes ? 'everyone' : null
}

// Sessizliğin bitişi (ISO metni) ya da süresizse null
export function sessizBitisi(saat, simdi = Date.now()) {
  if (saat == null) return null
  return new Date(simdi + saat * 3600 * 1000).toISOString()
}

// Kanal ayarları içinde gelecekte biten en yakın sessizliğin zamanı (ms); yoksa null.
// Süre dolunca kanal listesi yeniden çizilsin diye zamanlayıcı kurulur.
export function enYakinBitis(kanalAyarlari, simdi = Date.now()) {
  let enYakin = null
  for (const a of kanalAyarlari.values()) {
    if (!a?.muted || a.mutedUntil == null) continue
    const t = Date.parse(a.mutedUntil)
    if (!Number.isFinite(t) || t <= simdi) continue
    if (enYakin == null || t < enYakin) enYakin = t
  }
  return enYakin
}
