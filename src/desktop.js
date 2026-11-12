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
