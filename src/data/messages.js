// Mesaj işlemleri: okuma, gönderme, anlık abonelik, yazar profilleri.
import { supabase } from '../lib/supabase.js'

export const MAX_UZUNLUK = 2000
export const SAYFA = 50

// Kanalın mesajları, ESKİDEN YENİYE sıralı.
// before verilirse yalnızca o id'den daha eski mesajlar gelir (yukarı kaydırma için).
// after verilirse o id'den SONRAKİ ilk mesajlar gelir (bağlantı kopunca kaçanları almak için).
export async function fetchMessages(channelId, { before, after, limit = SAYFA } = {}) {
  let sorgu = supabase.from('messages').select('*').eq('channel_id', channelId)
  if (after != null) {
    // after'dan hemen sonraki mesajlar: id artan sırada doğrudan gelir
    const { data, error } = await sorgu.gt('id', after).order('id', { ascending: true }).limit(limit)
    if (error) throw new Error(error.message)
    return data ?? []
  }
  if (before != null) sorgu = sorgu.lt('id', before)
  // Veritabanından en yeniler gelir (id azalan), sonra çevirip eskiden yeniye dizeriz.
  const { data, error } = await sorgu.order('id', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).slice().reverse()
}

// Mesaj gönderir. Boşluklar kırpılır.
// Dönüş: { ok: true, message } | { ok: false, warning } (boş ya da çok uzunsa hiç gönderilmez).
// Veritabanı hatasında Error fırlatır.
export async function sendMessage(channelId, content, authorId) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, author_id: authorId, content: metin })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return { ok: true, message: data }
}

// Kanala yeni mesaj düşünce onInsert(mesaj) çağrılır. Dönen fonksiyon aboneliği kapatır.
// getLastId(): ekranda olan en yeni mesajın id'si. Bağlantı kopup yeniden kurulunca (2. ve sonraki
// SUBSCRIBED) aradaki mesajlar bu id'den sonrası sorgulanıp yine onInsert ile verilir.
let abonelikSayaci = 0
export function subscribeMessages(channelId, onInsert, { getLastId } = {}) {
  let kapandi = false
  let baglanmaSayisi = 0

  // Kopukken kaçan mesajları sayfa sayfa getirir (sayfa doluysa devamı da olabilir)
  async function geriDoldur() {
    let son = getLastId?.()
    for (let sayfa = 0; son != null && sayfa < 20 && !kapandi; sayfa++) {
      const gelen = await fetchMessages(channelId, { after: son, limit: SAYFA })
      if (kapandi) return
      for (const m of gelen) onInsert(m)
      if (gelen.length < SAYFA) return
      son = gelen.at(-1).id
    }
  }

  // Her abonelik benzersiz bir konu alır: kanal hızla a->b->a değişse bile yarı kapanmış kanal yeniden kullanılmaz
  const kanal = supabase
    .channel(`messages:${channelId}:${++abonelikSayaci}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (olay) => { if (!kapandi) onInsert(olay.new) },
    )
    .subscribe((durum) => {
      if (durum !== 'SUBSCRIBED' || kapandi) return
      baglanmaSayisi++
      // İlk bağlanışta mesajları ilk yükleme getiriyor; sonrakiler yeniden bağlanma demek
      if (baglanmaSayisi > 1) geriDoldur().catch(() => { /* bir sonraki bağlanışta yine denenir */ })
    })
  return () => { kapandi = true; supabase.removeChannel(kanal) }
}

// Verilen id'lerin profillerini tek sorguda getirir.
export async function fetchProfiles(ids) {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('profiles').select('id, username, color, avatar_url').in('id', ids)
  if (error) throw new Error(error.message)
  return data ?? []
}
