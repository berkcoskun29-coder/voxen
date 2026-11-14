// Okunmamış sayacının durumu: kanal başına sayı, toplamlar, başlık yazısı. Ekran çizimi yapmaz:
// değişince onChange çağrılır, app.js listeleri yeniden çizer.
// Kurallar: kendi mesajım sayılmaz; açık kanal, pencere odaktayken ve en alttayken artmaz (okundu işaretlenir);
// silme/yeniden bağlanma sayıları sunucudan yeniden alır (sorgu birleştirilir; her mesajda ağır sorgu yok).
import { fetchUnreadCounts, markRead, subscribeAllMessages } from '../data/reads.js'
import { mentionsUser, mentionsEveryone } from '../mentions.js'

export const unreadTiming = { refetchMs: 2000 }

// Rozet yazısı: 99'dan büyükse "99+", sıfırsa boş
export function sayiYazisi(n) {
  if (!n || n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

// Pencere başlığı: okunmamış varsa "(N) Voxen"
export function baslikYazisi(toplam) {
  const y = sayiYazisi(toplam)
  return y ? `(${y}) Voxen` : 'Voxen'
}

// profileId: kendi mesajlarım için. getReading(): { channelId, atBottom } | null (açık yazılı sohbet).
// isFocused(): pencere odakta mı. onChange(): sayılar değişti.
// getUsername(): kendi kullanıcı adım (@bahsetme sayısı için; ad değişebilir, o yüzden her mesajda sorulur).
// Bahsetme sayısı ayrı bir sayaç değil, okunmamış sayısının yanında durur: açılışta unread_counts().mentions,
// sonra beni anan her yeni mesajda +1 (src/mentions.js), okundu işaretlenince 0.
// onMessage(mesaj, serverId) (isteğe bağlı): başkasının yeni mesajı geldi (bildirimler bunu kullanır; aynı
// tek abonelik). serverId sayaçta bilinmeyen kanalda null.
// isMuted(kanalId) (isteğe bağlı, v0.13.0): kanal sessizde mi. Sessiz kanalın sayısı sunucu sayısına ve toplama
// katılmaz; bahsetmeleri katılır (sessiz kanalda da beni anan mesajın @ rozeti görünür).
export function createUnreadTracker({ profileId, getReading, isFocused, onChange, getUsername = null, onMessage = null, isMuted = null }) {
  let sayilar = new Map() // kanalId -> { serverId, count, mentions }
  let kapandi = false
  let zamanlayici = null
  let aliniyor = false
  let tekrarIstendi = false

  const degisti = () => { if (!kapandi) onChange?.() }
  const sessiz = (channelId) => { try { return !!isMuted?.(channelId) } catch { return false } }

  // Açık kanal şu an "okunuyor" mu (odakta ve en altta)?
  function okunuyor(channelId) {
    const r = getReading?.()
    return !!r && r.channelId === channelId && !!r.atBottom && !!isFocused?.()
  }

  function sifirla(channelId) {
    const s = sayilar.get(channelId)
    if (s && (s.count !== 0 || s.mentions)) { sayilar.set(channelId, { ...s, count: 0, mentions: 0 }); return true }
    return false
  }

  async function yenidenAl() {
    if (kapandi) return
    if (aliniyor) { tekrarIstendi = true; return }
    aliniyor = true
    try {
      do {
        tekrarIstendi = false
        let yeni
        try { yeni = await fetchUnreadCounts() } catch { yeni = null } // ağ yok: eski sayılar kalır, sonraki olayda yeniden denenir
        if (kapandi) return
        if (yeni) {
          sayilar = yeni
          // Açık ve okunan kanalın işareti henüz yazılmamış olabilir: sunucudaki eski sayıyı gösterme
          const r = getReading?.()
          if (r && okunuyor(r.channelId)) sifirla(r.channelId)
          degisti()
        }
      } while (tekrarIstendi && !kapandi)
    } finally { aliniyor = false }
  }

  // Silme gibi olaylarda 2 sn içindeki istekler tek sorguya birleşir
  function gecikmeliAl() {
    if (kapandi || zamanlayici) return
    zamanlayici = setTimeout(() => { zamanlayici = null; yenidenAl() }, unreadTiming.refetchMs)
  }

  const kapat = subscribeAllMessages({
    onInsert: (m) => {
      if (kapandi || !m || m.author_id === profileId || m.deleted_at) return
      const s = sayilar.get(m.channel_id)
      try { onMessage?.(m, s?.serverId ?? null) } catch { /* bildirim hatası sayacı bozmasın */ }
      if (!s) { gecikmeliAl(); return } // bilmediğimiz kanal (yeni kanal / sesli): yalnız sayılar yeniden alınır
      if (okunuyor(m.channel_id)) { markRead(m.channel_id, m.id); return }
      const anar = mentionsUser(m.content, getUsername?.())
      sayilar.set(m.channel_id, { ...s, count: s.count + 1, mentions: (s.mentions ?? 0) + (anar ? 1 : 0) })
      degisti()
      // @herkes (013): sayılıp sayılmayacağı yazarın MENTION_EVERYONE iznine bağlı; karar veritabanında
      // (unread_counts). Beni zaten anmıyorsa sayılar kısa süre sonra sunucudan yeniden alınır.
      if (!anar && mentionsEveryone(m.content)) gecikmeliAl()
    },
    onUpdate: (m) => { if (m?.deleted_at && m.author_id !== profileId) gecikmeliAl() },
    onReconnect: () => { yenidenAl() },
  })

  yenidenAl() // açılışta

  return {
    // Kanal başına sayı (sesli kanallar listede yoktur: 0)
    count(channelId) { return sayilar.get(channelId)?.count ?? 0 },
    // Sunucunun okunmamış toplamı (sessiz kanallar hariç)
    serverCount(serverId) {
      let t = 0
      for (const [k, s] of sayilar) if (s.serverId === serverId && !sessiz(k)) t += s.count
      return t
    },
    // Kanalda / sunucuda beni anan okunmamış mesaj sayısı
    mentions(channelId) { return sayilar.get(channelId)?.mentions ?? 0 },
    serverMentions(serverId) {
      let t = 0
      for (const s of sayilar.values()) if (s.serverId === serverId) t += s.mentions ?? 0
      return t
    },
    // Bütün okunmamışlar (sessiz kanallar hariç)
    total() {
      let t = 0
      for (const [k, s] of sayilar) if (!sessiz(k)) t += s.count
      return t
    },
    // Bütün bahsetmeler; haric: Set<serverId> sayılmayacak sunucular (sessize alınanlar). Rozet ve başlık bunu sayar.
    mentionTotal(haric = null) {
      let t = 0
      for (const s of sayilar.values()) if (!haric?.has?.(s.serverId)) t += s.mentions ?? 0
      return t
    },
    // "Tümünü okundu say" (mark_server_read yazıldıktan sonra): sunucunun bütün kanalları yerelde sıfırlanır
    markServerRead(serverId) {
      let degistiMi = false
      for (const [k, s] of sayilar) if (s.serverId === serverId && sifirla(k)) degistiMi = true
      if (degistiMi) degisti()
    },
    // Açık kanal okundu: yerel sayı sıfırlanır, işaret yazılır (id yoksa yalnız sayı sıfırlanır)
    markChannelRead(channelId, messageId) {
      if (messageId != null) markRead(channelId, messageId)
      if (sifirla(channelId)) degisti()
    },
    // Sunucu ya da kanal listesi değişti (kanal geldi/gitti): sayılar yeniden alınır
    refresh() { gecikmeliAl() },
    // Listede olmayan sunucuların/kanalların sayıları toplamı bozmasın
    prune(serverIds) {
      let degistiMi = false
      for (const [k, s] of sayilar) if (!serverIds.has(s.serverId)) { sayilar.delete(k); degistiMi = true }
      if (degistiMi) degisti()
    },
    destroy() {
      kapandi = true
      clearTimeout(zamanlayici)
      zamanlayici = null
      kapat()
    },
  }
}
