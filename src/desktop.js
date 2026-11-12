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
