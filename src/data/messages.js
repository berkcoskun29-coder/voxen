// Mesaj işlemleri: okuma, gönderme, düzenleme, silme, anlık abonelik, yazar profilleri.
import { supabase } from '../lib/supabase.js'
import { joinTyping } from './typing.js'
import { markRead } from './reads.js'

export const MAX_UZUNLUK = 2000
export const SAYFA = 50

// Kanalın mesajları, ESKİDEN YENİYE sıralı.
// before verilirse yalnızca o id'den daha eski mesajlar gelir (yukarı kaydırma için).
// after verilirse o id'den SONRAKİ ilk mesajlar gelir (bağlantı kopunca kaçanları almak için).
// Silinmiş mesajlar (deleted_at dolu) hiç gelmez.
export async function fetchMessages(channelId, { before, after, limit = SAYFA } = {}) {
  let sorgu = supabase.from('messages').select('*').eq('channel_id', channelId).is('deleted_at', null)
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

// Mesajı düzenler (yalnız yazarı; kural veritabanında, edit_message RPC'si). Boşluklar kırpılır.
// Dönüş: { ok: true, message } (düzenlenmiş satır) | { ok: false, warning } (boş ya da çok uzunsa gönderilmez).
// Veritabanı hatasında Error fırlatır.
export async function editMessage(id, content) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const { data, error } = await supabase.rpc('edit_message', { id, yeni: metin })
  if (error) throw new Error(error.message)
  return { ok: true, message: data }
}

// Mesajı siler (yazarı ya da sunucu sahibi; delete_message RPC'si). Silme yumuşaktır:
// satır kalır, içerik boşalır; abonelere UPDATE olayı olarak gider (deleted_at dolu).
export async function deleteMessage(id) {
  const { error } = await supabase.rpc('delete_message', { id })
  if (error) throw new Error(error.message)
}

// Kanala yeni mesaj düşünce onInsert(mesaj) çağrılır. Dönen fonksiyon aboneliği kapatır.
// onUpdate(mesaj): mesaj düzenlenince ya da silinince (mesaj.deleted_at dolu) çağrılır.
// getLastId(): ekranda olan en yeni mesajın id'si. Bağlantı kopup yeniden kurulunca (2. ve sonraki
// SUBSCRIBED) aradaki mesajlar bu id'den sonrası sorgulanıp yine onInsert ile verilir.
// onReconnect(): yeniden bağlanınca bir kez çağrılır (düzenleme/silme uzlaştırması için).
let abonelikSayaci = 0
export function subscribeMessages(channelId, onInsert, { onUpdate, getLastId, onReconnect } = {}) {
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
  const suzgec = { schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }
  const kanal = supabase
    .channel(`messages:${channelId}:${++abonelikSayaci}`)
    .on('postgres_changes', { event: 'INSERT', ...suzgec }, (olay) => { if (!kapandi) onInsert(olay.new) })
  // Düzenleme/silme olayları yalnız isteyen için dinlenir
  if (onUpdate) {
    kanal.on('postgres_changes', { event: 'UPDATE', ...suzgec }, (olay) => { if (!kapandi) onUpdate(olay.new) })
  }
  kanal.subscribe((durum) => {
    if (durum !== 'SUBSCRIBED' || kapandi) return
    baglanmaSayisi++
    // İlk bağlanışta mesajları ilk yükleme getiriyor; sonrakiler yeniden bağlanma demek
    if (baglanmaSayisi > 1) {
      geriDoldur().catch(() => { /* bir sonraki bağlanışta yine denenir */ })
      onReconnect?.() // geri doldurma yalnız yeni mesajları getirir; kopukken olan düzenleme/silmeleri çağıran uzlaştırır
    }
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

// ---------- chatView kaynağı ----------
// Sohbet ekranı (mountChat) mesajları bir "kaynak" nesnesinden alır; aynı ekran hem kanalı hem DM'i
// gösterir (DM karşılığı: dms.js dmSource). Kanal kaynağı buradaki fonksiyonları sarar.
// channel: { id, name }. isOwner: sunucunun sahibi mi (başkasının mesajını da silebilir). selfId: kendi id'miz.
// Dönen: { kind:'channel', id, title, placeholder, other:null, canSend, fetch(beforeId, { after, limit }),
//   send(content), edit(id, content), remove(id), subscribe({ onInsert, onUpdate, getLastId, onReconnect }) -> kapat,
//   joinTyping({ selfId, selfName, onChange }), markRead(id), canDelete(msg) }
export function channelSource(channel, { isOwner = false, selfId } = {}) {
  const id = channel.id
  return {
    kind: 'channel',
    id,
    title: channel.name,
    placeholder: `#${channel.name} kanalına mesaj yaz…`,
    other: null,
    canSend: true,
    fetch: (beforeId, { after, limit } = {}) => fetchMessages(id, { before: beforeId ?? undefined, after, limit }),
    send: (content) => sendMessage(id, content, selfId),
    edit: (mesajId, content) => editMessage(mesajId, content),
    remove: (mesajId) => deleteMessage(mesajId),
    subscribe: ({ onInsert, onUpdate, getLastId, onReconnect } = {}) =>
      subscribeMessages(id, (m) => onInsert?.(m), { onUpdate, getLastId, onReconnect }),
    joinTyping: (opts = {}) => joinTyping(id, opts),
    markRead: (mesajId) => markRead(id, mesajId),
    // Sunucu sahibi başkasının mesajını da silebilir
    canDelete: (msg) => msg?.author_id === selfId || isOwner,
  }
}
