// Kişiye özel olaylar: arkadaşlık isteği/kabul/çıkarma, engel ve yeni DM konuşması olunca veritabanı
// tetikleyicileri private "user:<uid>" konusuna "degisti" yayını gönderir
// (supabase/migrations/007_sosyal.sql, kisi_olayi_gonder). Konuyu yalnız kişinin kendisi alır;
// istemci yalnız dinler, göndermek yasaktır. Olayı alan arkadaş ve DM listelerini yeniden alır.
// Kişi başına TEK abonelik: arkadaş ya da DM sayısıyla artmaz.
import { openPrivateChannel } from './privateChannel.js'

// onChange(payload): olay geldi. payload veritabanından gelir:
//   { tablo: 'friendships'|'dm_threads'|'blocks', islem: 'INSERT'|'UPDATE'|'DELETE' }
//   Bağlantı kopup yeniden kurulunca (kaçan olay olabilir) payload { yeniden: true } olur.
// onCall(payload): verilirse aynı konudaki "arama" yayınları da iletilir (DM araması, 008_dm_arama.sql:
//   { call_id, thread_id, status, caller, reason }; ayrıştırma data/calls.js parseCallEvent). Yeni abonelik açılmaz.
// Dönen: { close() -> Promise }
export function subscribeUserEvents(userId, onChange, { onCall = null } = {}) {
  let kapali = false
  let baglanmaSayisi = 0
  const ozel = openPrivateChannel(
    `user:${userId}`,
    (k) => {
      if (onCall) {
        k.on('broadcast', { event: 'arama' }, ({ payload }) => {
          if (!kapali) onCall(payload ?? {})
        })
      }
      k.on('broadcast', { event: 'degisti' }, ({ payload }) => {
        if (!kapali) onChange?.(payload ?? {})
      })
    },
    (durum) => {
      if (durum !== 'SUBSCRIBED') return
      baglanmaSayisi++
      if (baglanmaSayisi > 1 && !kapali) onChange?.({ yeniden: true })
    },
  )
  return {
    close() {
      kapali = true
      return ozel.close()
    },
  }
}
