// Özel (private) Realtime yayın kanalı açar: "typing:<id>", "server:<id>" gibi konular için.
// voice/signal.js'deki iki kural burada da geçerli:
//  1) realtime-js aynı konu için, eski kanalın ayrılması sunucuca onaylanana kadar ESKİ kanal
//     nesnesini geri verir; ona subscribe() hiçbir şey yapmaz. Bu yüzden aynı konudaki önceki
//     kapanışın bitmesini bekleyip ancak sonra yeni kanal açarız.
//  2) Private kanal, kullanıcının güncel oturum anahtarını (JWT) ister: açmadan önce setAuth.
// Konu tam olarak "<ön ek>:<uuid>" olmalı (sona sayaç eklenemez): yetki kuralı konuyu okur.
import { supabase } from '../lib/supabase.js'

const kapanislar = new Map() // konu -> o konudaki son kapanışın Promise'i

// kur(kanal): olay dinleyicilerini ekler (subscribe'dan önce çağrılır).
// onStatus(durum): 'SUBSCRIBED', 'CHANNEL_ERROR' ... (kapandıktan sonra çağrılmaz).
// Dönen: { kanal() -> açıksa kanal nesnesi, yoksa null; close() -> Promise }
export function openPrivateChannel(topic, kur, onStatus) {
  let kapali = false
  let kanal = null

  const hazir = (async () => {
    try { await kapanislar.get(topic) } catch { /* önemli değil */ }
    try { await supabase.realtime?.setAuth?.() } catch { /* anahtar yoksa katılma reddedilir */ }
    if (kapali) return null
    // self: false -> kendi gönderdiğimiz yayın bize geri gelmez
    const k = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
    kur(k)
    kanal = k
    k.subscribe((durum) => { if (!kapali) onStatus?.(durum) })
    return k
  })()

  return {
    kanal: () => (kapali ? null : kanal),
    // Kanalı bırakır. Dönen Promise, kanal realtime-js'den tamamen çıkınca biter.
    close() {
      if (kapali) return kapanislar.get(topic) ?? Promise.resolve()
      kapali = true
      const kapanis = hazir
        .then((k) => (k ? supabase.removeChannel(k) : null))
        .catch(() => {})
        .finally(() => { if (kapanislar.get(topic) === kapanis) kapanislar.delete(topic) })
      kapanislar.set(topic, kapanis)
      return kapanis
    },
  }
}
