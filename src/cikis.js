// Masaüstünde programdan düzgün çıkış (v0.13.0 düzeltme turu 1, Ö2).
// Tepsiden "Çıkış" ya da ("Kapatınca tepsiye küçült" kapalıyken) pencereyi kapatmak Rust'ta `app-quitting`
// olayını doğurur. Web sesli kanaldan ve aramadan ayrılır (bye + voice_states silme, okundular), sonra
// `quit_now` ile hemen çıkılır. Rust ayrıca 2 sn sonra her durumda çıkar (web cevap vermezse).

// temizle(): ayrılma işleri (Promise dönebilir). cik(): Rust'a "şimdi çık". sureMs: temizliğe en fazla bu kadar beklenir.
// Dönen: olay geldiğinde çağrılacak fonksiyon (bir kez çalışır).
export function createQuitHandler({ temizle, cik, sureMs = 1500 }) {
  let basladi = false
  return async function cikisaHazirlan() {
    if (basladi) return
    basladi = true
    let zaman
    try {
      await Promise.race([
        Promise.resolve().then(temizle),
        new Promise((r) => { zaman = setTimeout(r, sureMs) }),
      ])
    } catch { /* temizlik yarım kaldı: yine çıkılır */ }
    clearTimeout(zaman)
    try { await cik() } catch { /* Rust'ın yedek zamanlayıcısı çıkar */ }
  }
}
