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

// ---- Arka planda çalışma (v0.13.0): tepsi, kapatma davranışı, Windows açılışında başlatma ----

// Pencereyi kapatınca tepsiye mi küçülsün (true) yoksa programdan mı çıkılsın (false)? Rust'ta saklanır
// (src-tauri/src/main.rs set_close_to_tray); web açılışta ve ayar değişince bildirir.
export async function setCloseToTray(acik) {
  if (!isTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_close_to_tray', { acik: !!acik })
  } catch { /* eski masaüstü sürümünde komut yok: Rust varsayılanı (tepsiye küçült) kalır */ }
}

// Tepsi menüsündeki "Rahatsız etmeyin" işaretini durumla eşitler
export async function setTrayDnd(acik) {
  if (!isTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_tray_dnd', { acik: !!acik })
  } catch { /* işaret güncellenemezse menü yine çalışır */ }
}

// Windows açılışında başlat (tauri-plugin-autostart; izin: capabilities/default.json). Varsayılan kapalı.
let autostartModulu = null
const autostartApi = () => (autostartModulu ??= import('@tauri-apps/plugin-autostart'))

// Açık mı? Masaüstü değilse ya da sorulamazsa false
export async function getAutostart() {
  if (!isTauri()) return false
  try {
    const { isEnabled } = await autostartApi()
    return !!(await isEnabled())
  } catch { return false }
}

// Açar/kapatır. Dönen: başarılı mı
export async function setAutostart(acik) {
  if (!isTauri()) return false
  try {
    const { enable, disable } = await autostartApi()
    if (acik) await enable()
    else await disable()
    return true
  } catch { return false }
}

// Düzgün çıkış (Ö2): web temizliği bitirdi, Rust hemen çıksın (src/cikis.js)
export async function quitNow() {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('quit_now')
}
