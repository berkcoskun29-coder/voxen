// Mesaj işlemleri: okuma, gönderme, düzenleme, silme, anlık abonelik, yazar profilleri.
import { supabase } from '../lib/supabase.js'
import { joinTyping } from './typing.js'
import { markRead } from './reads.js'
import { etkilesimHatasi } from './reactions.js'
import { MESAJ_SECIMI } from './sorgular.js'
import { sendMessageWithAttachments, fetchAttachments, removeFiles } from './attachments.js'

export const MAX_UZUNLUK = 2000
export const SAYFA = 50

// Mesaj sorgusu tepkileri, sabit bilgisini (009) ve ekleri (010) de gömer: ek sorgu yok.
//   reactions: [{ emoji, user_id }]   pin: { pinned_at, pinned_by } | null   attachments: [{ id, path, ... }]
// Ayrıştırma: reactions.js gomuluTepkiler / gomuluSabit. Metin tek kaynakta: sorgular.js.
export { MESAJ_SECIMI }

// Kanalın mesajları, ESKİDEN YENİYE sıralı.
// before verilirse yalnızca o id'den daha eski mesajlar gelir (yukarı kaydırma için).
// after verilirse o id'den SONRAKİ ilk mesajlar gelir (bağlantı kopunca kaçanları almak için).
// Silinmiş mesajlar (deleted_at dolu) hiç gelmez.
export async function fetchMessages(channelId, { before, after, limit = SAYFA } = {}) {
  let sorgu = supabase.from('messages').select(MESAJ_SECIMI).eq('channel_id', channelId).is('deleted_at', null)
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
// replyTo: yanıtlanan mesajın id'si (aynı kanalda olmalı; veritabanı denetler). Yoksa alan hiç yazılmaz.
// Dönüş: { ok: true, message } | { ok: false, warning } (boş ya da çok uzunsa hiç gönderilmez).
// Veritabanı hatasında Error fırlatır.
export async function sendMessage(channelId, content, authorId, { replyTo = null } = {}) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const satir = { channel_id: channelId, author_id: authorId, content: metin }
  if (replyTo != null) satir.reply_to = replyTo
  const { data, error } = await supabase
    .from('messages')
    .insert(satir)
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

// ---------- Tepki, sabitleme, yanıt alıntısı (009) ----------

// Tepki ekler (ekle = true) ya da kendi tepkini kaldırır. İki yön de tekrarlanabilir.
// Hata: Türkçe metinli Error (reactions.js etkilesimHatasi).
export async function reactMessage(mid, emoji, ekle) {
  const { error } = await supabase.rpc('react_message', { mid, tepki: emoji, ekle: !!ekle })
  if (error) throw etkilesimHatasi(error)
}

// Sabitler / sabitlemeyi kaldırır (yalnız yetkili: can_pin). 50'yi aşarsa "En fazla 50 mesaj sabitlenebilir."
export async function pinMessage(mid, sabitle) {
  const { error } = await supabase.rpc('pin_message', { mid, sabitle: !!sabitle })
  if (error) throw etkilesimHatasi(error)
}

// Sabitlenmiş mesajlar (en yeni sabit üstte, en çok 50). Dönüş: mesaj satırları + pinned_at, pinned_by.
// Silinmiş mesajın sabiti veritabanında zaten kalkar; yine de güvenlik için süzülür.
export async function fetchPinnedMessages(channelId) {
  const { data, error } = await supabase
    .from('message_pins')
    .select('pinned_at, pinned_by, message:messages(*)')
    .eq('channel_id', channelId)
    .order('pinned_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return sabitSatirlari(data)
}

// message_pins / dm_message_pins satırlarını mesaj nesnelerine çevirir (dms.js de kullanır)
export function sabitSatirlari(data) {
  return (data ?? [])
    .map((r) => {
      const m = Array.isArray(r?.message) ? r.message[0] : r?.message
      return m ? { ...m, pinned_at: r.pinned_at, pinned_by: r.pinned_by } : null
    })
    .filter((m) => m && !m.deleted_at)
}

// Yanıt alıntısı için mesajları id ile getirir (silinmişler DE gelir: alıntı "Mesaj silindi" der).
export async function fetchMessagesByIds(ids) {
  if (!ids?.length) return []
  const { data, error } = await supabase
    .from('messages').select('id, channel_id, author_id, content, created_at, deleted_at').in('id', ids)
  if (error) throw new Error(error.message)
  return data ?? []
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
// getYetki(): (isteğe bağlı, v0.11.0) bu sunucudaki güncel yetkim (src/data/rolKurallari.js yetkiHesapla);
//   her soruda yeniden okunur: rol değişince sohbet yeniden kurulmadan düğmeler değişir.
// Dönen: { kind:'channel', id, title, placeholder, other:null, canSend, fetch(beforeId, { after, limit }),
//   send(content, { replyTo }), edit(id, content), remove(id), subscribe({ onInsert, onUpdate, getLastId, onReconnect }) -> kapat,
//   joinTyping({ selfId, selfName, onChange }), markRead(id), canDelete(msg), canEdit(msg),
//   react(id, emoji, ekle), pin(id, sabitle), fetchPinned(), fetchByIds(ids), canReact(msg), canPin(msg),
//   ekKlasoru, sendWithAttachments(content, ekler, { replyTo }), fetchAttachments(ids), removeFiles(yollar) }
export function channelSource(channel, { isOwner = false, selfId, getYetki = null } = {}) {
  const id = channel.id
  // Mesajları yönetme (başkasının mesajını silme, sabitleme): sahip ya da MANAGE_MESSAGES (013: has_permission)
  const mesajYoneticisi = () => isOwner || !!getYetki?.()?.has?.('MANAGE_MESSAGES')
  return {
    kind: 'channel',
    id,
    title: channel.name,
    placeholder: `#${channel.name} kanalına mesaj yaz…`,
    other: null,
    canSend: true,
    fetch: (beforeId, { after, limit } = {}) => fetchMessages(id, { before: beforeId ?? undefined, after, limit }),
    send: (content, { replyTo } = {}) => sendMessage(id, content, selfId, { replyTo }),
    // Ekler (010): depo klasörü k/<kanal>; mesaj + ekler tek RPC'de
    ekKlasoru: `k/${id}`,
    sendWithAttachments: (content, ekler, { replyTo } = {}) => sendMessageWithAttachments(id, content, ekler, { replyTo }),
    fetchAttachments: (ids) => fetchAttachments('channel', ids),
    removeFiles: (yollar) => removeFiles(yollar),
    react: (mesajId, emoji, ekle) => reactMessage(mesajId, emoji, ekle),
    pin: (mesajId, sabitle) => pinMessage(mesajId, sabitle),
    fetchPinned: () => fetchPinnedMessages(id),
    fetchByIds: (ids) => fetchMessagesByIds(ids),
    // Kanalda her üye tepki verir. Sabitleme: sahip ya da MANAGE_MESSAGES (veritabanında can_pin)
    canReact: (msg) => !!msg && !msg.deleted_at,
    canPin: (msg) => !!msg && !msg.deleted_at && mesajYoneticisi(),
    edit: (mesajId, content) => editMessage(mesajId, content),
    remove: (mesajId) => deleteMessage(mesajId),
    subscribe: ({ onInsert, onUpdate, getLastId, onReconnect } = {}) =>
      subscribeMessages(id, (m) => onInsert?.(m), { onUpdate, getLastId, onReconnect }),
    joinTyping: (opts = {}) => joinTyping(id, opts),
    markRead: (mesajId) => markRead(id, mesajId),
    // Sahip ya da MANAGE_MESSAGES başkasının mesajını da silebilir
    canDelete: (msg) => msg?.author_id === selfId || mesajYoneticisi(),
    // Düzenleme yalnız kendi mesajında (sahip de başkasınınkini düzenleyemez)
    canEdit: (msg) => msg?.author_id === selfId,
  }
}
