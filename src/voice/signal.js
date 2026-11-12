// Sesli kanalın sinyal (tanışma) yolu: Supabase Realtime yayın (broadcast) kanalı.
// PeerMesh'in beklediği biçim: signal(topic, onMessage, onStatus) -> { send(msg), close() -> Promise }
//
// Önemli iki nokta:
//  1) realtime-js aynı konu için, eski kanalın ayrılması sunucuca onaylanana kadar ESKİ kanal
//     nesnesini geri verir; ona subscribe() hiçbir şey yapmaz. Bu yüzden aynı konudaki önceki
//     kapanışın bitmesini bekleyip ancak sonra yeni kanal açarız.
//  2) Kanal "private": sadece o sunucunun üyeleri (giriş yapmış, JWT'li) katılabilir.
//     Yetki kuralları: supabase/migrations/003_realtime_voice_auth.sql
import { supabase } from '../lib/supabase.js'

export const SIGNAL_EVENTS = ['hello', 'offer', 'answer', 'ice', 'bye']

const kapanislar = new Map() // konu -> o konudaki son kapanışın Promise'i

export function supabaseSignal(topic, onMessage, onStatus) {
  let kapali = false
  let kanal = null

  // Kanalı asenkron kur: önce aynı konudaki eski kanalın kapanışını bekle
  const hazir = (async () => {
    try { await kapanislar.get(topic) } catch { /* önemli değil */ }
    // Kullanıcının güncel oturum anahtarını (JWT) realtime'a ver: private kanal bunu ister
    try { await supabase.realtime?.setAuth?.() } catch { /* anahtar yoksa katılma reddedilir */ }
    if (kapali) return null
    // self: false -> kendi gönderdiğimiz mesaj bize geri gelmez
    kanal = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
    for (const olay of SIGNAL_EVENTS) {
      kanal.on('broadcast', { event: olay }, ({ payload }) => onMessage({ ...payload, type: olay }))
    }
    kanal.subscribe((durum) => { if (!kapali) onStatus(durum) })
    return kanal
  })()

  return {
    send(msg) {
      if (kapali || !kanal) return
      // Gönderilemezse (bağlantı yok) sessizce geç: yeniden bağlanınca hello tekrar gider
      try {
        Promise.resolve(kanal.send({ type: 'broadcast', event: msg.type, payload: msg })).catch(() => {})
      } catch { /* yok say */ }
    },
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
