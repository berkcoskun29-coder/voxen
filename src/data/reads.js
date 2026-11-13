// Okunmamış mesaj sayısı: sayıları alma, "okundu" işaretleme, sayaç için tek abonelik.
// Kurallar veritabanında: supabase/migrations/006_temel_ozellikler.sql (channel_reads,
// unread_counts, mark_read). Sayılan: başkasının yazdığı, silinmemiş mesajlar (en fazla 100; arayüz 99'dan büyükse "99+" gösterir).
import { supabase } from '../lib/supabase.js'

// Üyesi olduğum bütün yazılı kanalların okunmamış sayıları.
// Dönüş: Map<kanalId, { serverId, count, mentions }> (okunmamışı olmayan kanallar count: 0 ile gelir).
// mentions: okunmamışlardan beni ananların sayısı (007; sütun yoksa 0).
export async function fetchUnreadCounts() {
  const { data, error } = await supabase.rpc('unread_counts')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((r) => [
    r.channel_id,
    { serverId: r.server_id, count: r.count, mentions: r.mentions ?? 0 },
  ]))
}

// ---------- Okundu işaretleme ----------
// markRead sık çağrılabilir (her yeni mesajda, her kaydırmada). Burada:
//  - Yalnız ileri gider: daha önce işaretlenenden küçük ya da eşit id yok sayılır.
//  - En fazla coalesceMs'de bir yazılır; arada gelenler birleşir (hedef başı en büyük id gider).
//  - Yazma başarısız olursa o hedef için "gönderildi" bilgisi geri alınır: sonraki çağrı yeniden dener.
// Aynı kalıp DM'lerde de kullanılır (dms.js, mark_dm_read): createReadMarker.
export const readTiming = { coalesceMs: 1000 }

// rpcAdi: çağrılacak RPC; argumanlar(hedefId, mesajId) -> RPC argüman nesnesi.
// Dönen: { mark(hedefId, mesajId), flush() -> Promise, reset() }
export function createReadMarker(rpcAdi, argumanlar) {
  const gonderilen = new Map() // hedefId -> veritabanına gönderdiğimiz en büyük id
  const bekleyen = new Map() // hedefId -> henüz gönderilmemiş en büyük id
  let zamanlayici = null

  function mark(hedefId, messageId) {
    if (!hedefId || messageId == null) return
    const id = Number(messageId)
    if (!Number.isFinite(id)) return
    const enBuyuk = Math.max(gonderilen.get(hedefId) ?? -1, bekleyen.get(hedefId) ?? -1)
    if (id <= enBuyuk) return
    bekleyen.set(hedefId, id)
    if (!zamanlayici) zamanlayici = setTimeout(gonder, readTiming.coalesceMs)
  }

  function gonder() {
    zamanlayici = null
    const liste = [...bekleyen]
    bekleyen.clear()
    return Promise.all(liste.map(async ([hid, mid]) => {
      const onceki = gonderilen.get(hid)
      gonderilen.set(hid, mid)
      try {
        const { error } = await supabase.rpc(rpcAdi, argumanlar(hid, mid))
        if (error) throw new Error(error.message)
      } catch {
        // Gitmedi: geri al (bu arada daha büyüğü gönderildiyse dokunma)
        if (gonderilen.get(hid) === mid) {
          if (onceki == null) gonderilen.delete(hid)
          else gonderilen.set(hid, onceki)
        }
      }
    }))
  }

  return {
    mark,
    // Bekleyen işaretleri hemen yazar (örn. pencere kapanırken). Yazmalar bitince çözülür.
    flush() {
      clearTimeout(zamanlayici)
      return gonder().then(() => {})
    },
    reset() {
      clearTimeout(zamanlayici)
      zamanlayici = null
      gonderilen.clear()
      bekleyen.clear()
    },
  }
}

const kanalOkuma = createReadMarker('mark_read', (cid, mid) => ({ cid, mid }))

// Kanalı bu mesaja kadar okundu işaretler (birleştirilerek, gecikmeli yazılır)
export function markRead(channelId, messageId) { kanalOkuma.mark(channelId, messageId) }

// Bekleyen işaretleri hemen yazar (örn. pencere kapanırken). Yazmalar bitince çözülür.
export function flushReads() { return kanalOkuma.flush() }

// (test için) durumu sıfırlar
export function resetReads() { kanalOkuma.reset() }

// ---------- Sayaç aboneliği ----------
// Üye olduğum bütün kanalların mesajlarını TEK abonelikle dinler: süzgeç yok, RLS süzer.
// onInsert(mesaj): yeni mesaj. onUpdate(mesaj): düzenleme/silme (deleted_at dolu = silindi).
// onReconnect(): bağlantı kopup yeniden kurulunca (2. ve sonraki SUBSCRIBED): sayılar yeniden alınmalı.
// Dönen fonksiyon aboneliği kapatır.
let abonelikSayaci = 0
export function subscribeAllMessages({ onInsert, onUpdate, onReconnect } = {}) {
  let kapandi = false
  let baglanmaSayisi = 0
  const tablo = { schema: 'public', table: 'messages' }
  const kanal = supabase
    .channel(`messages-all:${++abonelikSayaci}`)
    .on('postgres_changes', { event: 'INSERT', ...tablo }, (olay) => { if (!kapandi) onInsert?.(olay.new) })
    .on('postgres_changes', { event: 'UPDATE', ...tablo }, (olay) => { if (!kapandi) onUpdate?.(olay.new) })
  kanal.subscribe((durum) => {
    if (durum !== 'SUBSCRIBED' || kapandi) return
    baglanmaSayisi++
    if (baglanmaSayisi > 1) onReconnect?.()
  })
  return () => { kapandi = true; supabase.removeChannel(kanal) }
}
