// "Yazıyor…" göstergesi: Supabase Realtime yayını (broadcast), veritabanına hiçbir satır yazılmaz.
// Konu kanal başına, private: "typing:<kanal uuid>". Yetki: yalnız o kanalın sunucusunun üyeleri
// alır ve gönderir (supabase/migrations/006_temel_ozellikler.sql, can_access_text_topic).
//
// Gönderim: yazarken en fazla sendEveryMs'de bir "yaziyor"; mesaj gidince ya da kutu boşalınca "birakti".
// Alım: her kişi son sinyalinden expireMs sonra kendiliğinden düşer; kendi sinyalimiz gösterilmez.
import { openPrivateChannel } from './privateChannel.js'

export const typingTiming = { sendEveryMs: 3000, expireMs: 5000 }

// Kanalın yazıyor konusuna katılır.
//  selfId: kendi kullanıcı id'miz (kendi sinyalimizi saymamak ve göndermek için)
//  selfName: başkalarına görünecek adımız
//  onChange(adlar, idler): yazanlar değişince; adlar ilk yazmaya başlayana göre sıralı
//  topic: (isteğe bağlı) konu; verilmezse "typing:<kanal>". DM'ler "dm-typing:<konuşma>" verir (dms.js).
// Dönen: { typing(), stopped(), clear(userId), leave() -> Promise }
//  - typing(): kutuya her yazışta çağrılır (gönderim kendiliğinden seyreltilir)
//  - stopped(): mesaj gönderildi ya da kutu boşaldı
//  - clear(userId): o kişinin mesajı geldi, göstergesi hemen kalksın
//  - leave(): kanal değişti/kapandı; bütün zamanlayıcılar temizlenir
export function joinTyping(channelId, { selfId, selfName, onChange, topic } = {}) {
  let kapali = false
  let bagli = false
  let sonGonderim = 0 // son "yaziyor" zamanı (0 = göndermedik ya da bıraktık)
  const yazanlar = new Map() // userId -> { name, timer }

  function yay() {
    if (kapali) return
    onChange?.([...yazanlar.values()].map((y) => y.name), [...yazanlar.keys()])
  }

  function kaldir(userId) {
    const y = yazanlar.get(userId)
    if (!y) return
    clearTimeout(y.timer)
    yazanlar.delete(userId)
    yay()
  }

  function yaziyorGeldi(payload) {
    const uid = payload?.user_id
    if (kapali || !uid || uid === selfId) return
    const name = String(payload.username ?? '').slice(0, 40) || 'Biri'
    const eski = yazanlar.get(uid)
    if (eski) clearTimeout(eski.timer)
    yazanlar.set(uid, { name, timer: setTimeout(() => kaldir(uid), typingTiming.expireMs) })
    if (!eski || eski.name !== name) yay()
  }

  function biraktiGeldi(payload) {
    const uid = payload?.user_id
    if (kapali || !uid || uid === selfId) return
    kaldir(uid)
  }

  const ozel = openPrivateChannel(
    topic ?? `typing:${channelId}`,
    (k) => {
      k.on('broadcast', { event: 'yaziyor' }, ({ payload }) => yaziyorGeldi(payload))
      k.on('broadcast', { event: 'birakti' }, ({ payload }) => biraktiGeldi(payload))
    },
    (durum) => { bagli = durum === 'SUBSCRIBED' },
  )

  // Yayını gönderir; bağlı değilsek gönderilmez (false döner)
  function gonder(event) {
    const k = ozel.kanal()
    if (kapali || !bagli || !k) return false
    try {
      Promise.resolve(k.send({ type: 'broadcast', event, payload: { user_id: selfId, username: selfName } }))
        .catch(() => {})
    } catch { /* bağlantı yok: önemli değil */ }
    return true
  }

  return {
    typing() {
      const simdi = Date.now()
      if (sonGonderim && simdi - sonGonderim < typingTiming.sendEveryMs) return
      if (gonder('yaziyor')) sonGonderim = simdi
    },
    stopped() {
      if (!sonGonderim) return
      sonGonderim = 0
      gonder('birakti')
    },
    clear(userId) { kaldir(userId) },
    leave() {
      if (!kapali) {
        if (sonGonderim) gonder('birakti')
        sonGonderim = 0
        kapali = true
        for (const y of yazanlar.values()) clearTimeout(y.timer)
        yazanlar.clear()
      }
      return ozel.close()
    },
  }
}
