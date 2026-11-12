// Sunucu olayları: sunucu silinince/adı değişince, kanal eklenince/silinince/adı değişince ya da
// biri sunucudan ayrılınca veritabanı tetikleyicileri o sunucunun private "server:<uuid>" konusuna
// "degisti" yayını gönderir (supabase/migrations/006_temel_ozellikler.sql). İstemci yalnız dinler;
// bu konuya göndermek yasaktır. Olayı alan, sunucu ve kanal listesini yeniden yükler.
import { openPrivateChannel } from './privateChannel.js'

// serverIds: üyesi olduğum sunucuların id'leri.
// onChange(serverId, payload): olay geldi. payload veritabanından gelir:
//   { tablo: 'servers'|'channels'|'server_members', islem: 'INSERT'|'UPDATE'|'DELETE',
//     server_id, channel_id, user_id }
//   Bağlantı kopup yeniden kurulunca (kaçan olay olabilir) payload { yeniden: true } olur.
// Dönen: { update(serverIds), close() }
//   update: sunucu listesi değişince çağrılır; yeni sunucuların konusu açılır, çıkanlarınki kapanır.
export function subscribeServerEvents(serverIds, onChange) {
  let kapali = false
  const acik = new Map() // serverId -> openPrivateChannel sonucu

  function ac(sid) {
    let baglanmaSayisi = 0
    const ozel = openPrivateChannel(
      `server:${sid}`,
      (k) => {
        k.on('broadcast', { event: 'degisti' }, ({ payload }) => {
          if (!kapali && acik.get(sid) === ozel) onChange?.(sid, payload ?? {})
        })
      },
      (durum) => {
        if (durum !== 'SUBSCRIBED') return
        baglanmaSayisi++
        if (baglanmaSayisi > 1 && !kapali && acik.get(sid) === ozel) onChange?.(sid, { yeniden: true })
      },
    )
    acik.set(sid, ozel)
  }

  function update(ids) {
    if (kapali) return
    const istenen = new Set(ids ?? [])
    for (const [sid, ozel] of acik) {
      if (!istenen.has(sid)) {
        acik.delete(sid)
        ozel.close()
      }
    }
    for (const sid of istenen) if (!acik.has(sid)) ac(sid)
  }

  update(serverIds)

  return {
    update,
    close() {
      if (kapali) return
      kapali = true
      for (const ozel of acik.values()) ozel.close()
      acik.clear()
    },
  }
}
