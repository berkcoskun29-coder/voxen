// Tek ayar nesnesi: localStorage['voxen.settings'] içinde saklanır.
// Başka hiçbir yer localStorage'a doğrudan ayar yazmaz; hep buradan geçer.
const KEY = 'voxen.settings'
const ESKI_GURULTU_ANAHTARI = 'voxen.settings.noiseSuppression' // eski tek ayar, bir kez taşınır

export const BITRATE_MIN = 32
export const BITRATE_MAX = 128

export const DEFAULTS = {
  mode: 'ptt', // 'ptt' (bas-konuş) | 'vad' (sesle algılama)
  pttKey: null, // KeyboardEvent.code, örn. "KeyV"; null = henüz seçilmedi
  noiseSuppression: true,
  bitrateKbps: 128,
  vadThreshold: 0.02,
  inputDeviceId: null,
  outputDeviceId: null,
}

let bellek = null // depolama kapalıysa ayarlar en azından bu oturum boyunca bellekte kalır
const dinleyiciler = new Set()

function sinirla(sayi, en_az, en_cok, varsayilan) {
  const n = Number(sayi)
  if (!Number.isFinite(n)) return varsayilan
  return Math.min(en_cok, Math.max(en_az, n))
}

// Bozuk / eksik / sınır dışı değerleri düzeltir
function temizle(ham) {
  const s = { ...DEFAULTS, ...(ham && typeof ham === 'object' ? ham : {}) }
  s.mode = s.mode === 'vad' ? 'vad' : 'ptt'
  s.pttKey = typeof s.pttKey === 'string' && s.pttKey ? s.pttKey : null
  s.noiseSuppression = s.noiseSuppression !== false
  s.bitrateKbps = Math.round(sinirla(s.bitrateKbps, BITRATE_MIN, BITRATE_MAX, DEFAULTS.bitrateKbps))
  s.vadThreshold = sinirla(s.vadThreshold, 0.005, 0.2, DEFAULTS.vadThreshold)
  s.inputDeviceId = s.inputDeviceId || null
  s.outputDeviceId = s.outputDeviceId || null
  return s
}

function oku() {
  try {
    const metin = localStorage.getItem(KEY)
    if (metin != null) return temizle(JSON.parse(metin))
    // İlk kez: eski gürültü engelleme anahtarı varsa ona göre başla ve eskisini sil
    const eski = localStorage.getItem(ESKI_GURULTU_ANAHTARI)
    if (eski != null) {
      const s = temizle({ noiseSuppression: eski !== 'false' })
      localStorage.setItem(KEY, JSON.stringify(s))
      localStorage.removeItem(ESKI_GURULTU_ANAHTARI)
      return s
    }
    return temizle(null) // hiçbir şey kayıtlı değil: varsayılanlar
  } catch {
    return temizle(bellek) // depolama kapalı ya da JSON bozuk: bellekteki son ayarlar (yoksa varsayılanlar)
  }
}

export function getSettings() {
  return oku()
}

// Verilen alanları günceller (diğerleri korunur), dinleyicilere haber verir, yeni ayarları döner.
export function updateSettings(parca) {
  const yeni = temizle({ ...oku(), ...parca })
  bellek = yeni
  try { localStorage.setItem(KEY, JSON.stringify(yeni)) } catch { /* sorun değil, bellekte kaldı */ }
  for (const cb of [...dinleyiciler]) cb(yeni)
  return yeni
}

// cb(yeniAyarlar) her güncellemede çağrılır. Dönen fonksiyon dinlemeyi bırakır.
export function onSettingsChange(cb) {
  dinleyiciler.add(cb)
  return () => dinleyiciler.delete(cb)
}
