// Masaüstü (Tauri) sürümüyle ilgili küçük yardımcılar.
// Web sürümünde Tauri yoktur; bu yüzden Tauri kütüphanesi yalnızca gerektiğinde (dinamik import) yüklenir.

// Program Voxen masaüstü uygulamasının içinde mi çalışıyor? (Tauri v2 bu nesneyi ekler)
export function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

// { listen, invoke }: Rust tarafından olay dinleme ve komut çağırma
export async function loadTauriApi() {
  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ])
  return { listen, invoke }
}

// Pencere başlığını ayarlar. Web'de document.title yeterli; masaüstünde Tauri'nin yerel pencere
// başlığı document.title'ı izlemez, bu yüzden ayrıca setTitle çağrılır (izin: capabilities/default.json).
export async function setWindowTitle(baslik) {
  if (typeof document !== 'undefined') document.title = baslik
  if (!isTauri()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTitle(baslik)
  } catch { /* başlık güncellenemezse sayaç yine de çalışır */ }
}

// ---- Bildirimler (tauri-plugin-notification; izin: capabilities/default.json "notification:default") ----
// Eklenti yalnız masaüstünde ve ilk kullanımda yüklenir.
let bildirimModulu = null
const bildirimApi = () => (bildirimModulu ??= import('@tauri-apps/plugin-notification'))

// Masaüstü bildirimi gösterir. id: 32 bit tam sayı. extra: bildirimin verisi (tıklanınca geri gelir).
// Windows'ta bildirimin kendi sesi yoktur (sessiz gösterilir); kısa sesi web tarafı çalar.
export async function showDesktopNotification({ id, title, body, extra }) {
  if (!isTauri()) return false
  try {
    const { sendNotification } = await bildirimApi()
    sendNotification({ id, title, body, extra })
    return true
  } catch { return false } // bildirim gösterilemezse uygulama bozulmasın
}

// Bildirime tıklanınca cb(hedef) çağrılır (hedef: bildirimin extra.hedef verisi).
// Eklenti tıklamayı yalnız bir dinleyici varken gösterilen bildirimlerde bildirir; Windows'ta ayrıca
// yalnız bildirim ekrandayken (Bildirim Merkezi'ne düştükten sonra değil). Dönen: dinlemeyi bırakan fonksiyon.
export async function onDesktopNotificationClick(cb) {
  if (!isTauri()) return () => {}
  try {
    const { onAction } = await bildirimApi()
    const dinleyici = await onAction((olay) => {
      const hedef = olay?.notification?.extra?.hedef
      if (hedef) cb(hedef)
    })
    return () => { Promise.resolve(dinleyici?.unregister?.()).catch(() => {}) }
  } catch { return () => {} }
}

// Pencereyi öne getirir (küçültülmüşse açar, tepsideyse gösterir). Web'de window.focus() yeterli.
export async function focusWindow() {
  if (!isTauri()) {
    try { window.focus() } catch { /* tarayıcı izin vermeyebilir */ }
    return
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const w = getCurrentWindow()
    await w.unminimize()
    await w.show()
    await w.setFocus()
  } catch { /* öne gelmezse hedef yine açılır */ }
}
