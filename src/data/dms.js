// Özel mesaj (DM): liste, açma, gizleme, mesajlar, tek abonelik, okundu işareti ve
// chatView'in kullandığı "kaynak" nesnesi (dmSource).
// Kurallar veritabanında (supabase/migrations/007_sosyal.sql): dm_messages yalnız iki tarafa açık;
// gönderme doğrudan INSERT (taraf + engel yok), düzenleme/silme RPC ile.
// 008_dm_arama.sql: dm_messages.kind ('text' | 'call'). Arama kaydı satırlarını yalnız sunucu yazar;
// düzenlenemez ve silinemez (dmSource.canEdit/canDelete false, RPC'ler de reddeder).
// 009_tepki_yanit_sabit.sql: kind 'pin' ("berk bir mesajı sabitledi."; yalnız pin_dm_message yazar),
// reply_to (yanıt), dm_message_reactions (tepki) ve dm_message_pins (sabit).
import { supabase } from '../lib/supabase.js'
import { MAX_UZUNLUK, SAYFA, sabitSatirlari } from './messages.js'
import { createReadMarker } from './reads.js'
import { joinTyping } from './typing.js'
import { rpcHatasi } from './friends.js'
import { etkilesimHatasi } from './reactions.js'
import { DM_MESAJ_SECIMI } from './sorgular.js'
import { sendDmWithAttachments, fetchAttachments, removeFiles } from './attachments.js'

// DM mesaj sorgusu: tepkiler, sabit bilgisi ve ekler gömülü (messages.js MESAJ_SECIMI'nin DM karşılığı)
export { DM_MESAJ_SECIMI }

export const GONDEREMEZSIN = 'Bu kişiye mesaj gönderemezsin.'
// Ekli DM gönderiminde engel kodları (engel bilgisi sızmaz: ikisi aynı metin)
const DM_EK_OZEL = { BLOCKED_DM: GONDEREMEZSIN, NOT_ALLOWED: GONDEREMEZSIN }
// DM bağlamında SELF'in istek cümlesi yanlış okunur
const DM_OZEL = { SELF: 'Kendine mesaj gönderemezsin.' }

// dm_list satırı -> konuşma nesnesi
function konusma(r) {
  return {
    id: r.thread_id,
    other: { id: r.other_id, username: r.username ?? '', color: r.color ?? null, avatar_url: r.avatar_url ?? null },
    createdAt: r.created_at ?? null,
    lastMessageAt: r.last_message_at ?? null,
    unread: r.unread ?? 0,
    canSend: r.can_send !== false,
  }
}

// DM listesi (gizlenenler hariç), son mesaja göre en yenisi üstte.
// Dönüş: [{ id, other: { id, username, color, avatar_url }, createdAt, lastMessageAt, unread, canSend }]
// unread en fazla 100 (arayüz 99'dan büyükse "99+"). canSend false: engel var, kutu kapanır.
export async function fetchDmList() {
  const { data, error } = await supabase.rpc('dm_list')
  if (error) throw new Error(error.message)
  return (data ?? []).map(konusma)
}

// Konuşmayı açar (yoksa oluşturur); konuşma id'sini döner. Gizlenmişse listede yeniden görünür.
// Hatada Türkçe metinli Error: izin yoksa/engelde "Bu kişiye mesaj gönderemezsin." (engelde var olan
// konuşma da açılmaz; eski mesajlar fetchDmList satırından, canSend=false ile açılır).
export async function openDm(otherId) {
  const { data, error } = await supabase.rpc('open_dm', { other: otherId })
  if (error) throw rpcHatasi(error, DM_OZEL)
  return data
}

// Konuşmayı listeden gizler (mesajlar silinmez; yeni mesaj gelince yine görünür)
export async function hideDm(threadId) {
  const { error } = await supabase.rpc('hide_dm', { tid: threadId })
  if (error) throw rpcHatasi(error)
}

// ---------- Mesajlar (messages.js'teki kanal karşılıklarıyla aynı davranış) ----------

// Konuşmanın mesajları, ESKİDEN YENİYE. before: o id'den eskiler; after: o id'den sonraki ilkler.
// Silinmiş mesajlar (deleted_at dolu) hiç gelmez. '*' 008'deki kind sütununu da getirir
// ('text' | 'call'; eski şemada yoksa undefined, düz mesaj sayılır).
export async function fetchDmMessages(threadId, { before, after, limit = SAYFA } = {}) {
  let sorgu = supabase.from('dm_messages').select(DM_MESAJ_SECIMI).eq('thread_id', threadId).is('deleted_at', null)
  if (after != null) {
    const { data, error } = await sorgu.gt('id', after).order('id', { ascending: true }).limit(limit)
    if (error) throw new Error(error.message)
    return data ?? []
  }
  if (before != null) sorgu = sorgu.lt('id', before)
  const { data, error } = await sorgu.order('id', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).slice().reverse()
}

// Gönderir. Dönüş: { ok: true, message } | { ok: false, warning } (boş ya da çok uzunsa gönderilmez).
// Veritabanı reddederse (engel: RLS) "Bu kişiye mesaj gönderemezsin." ile Error fırlatır.
// replyTo: yanıtlanan mesajın id'si (aynı konuşmada, düz mesaj; veritabanı denetler). Yoksa alan yazılmaz.
export async function sendDmMessage(threadId, content, authorId, { replyTo = null } = {}) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const satir = { thread_id: threadId, author_id: authorId, content: metin }
  if (replyTo != null) satir.reply_to = replyTo
  const { data, error } = await supabase
    .from('dm_messages')
    .insert(satir)
    .select()
    .single()
  if (error) {
    // 42501: RLS reddi (engel ya da konuşmanın tarafı değilsin)
    const rls = error.code === '42501' || /row-level security/i.test(String(error.message ?? ''))
    throw new Error(rls ? GONDEREMEZSIN : error.message)
  }
  return { ok: true, message: data }
}

// Düzenler (yalnız yazarı). Dönüş: { ok: true, message } | { ok: false, warning }.
export async function editDmMessage(id, content) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const { data, error } = await supabase.rpc('edit_dm_message', { id, yeni: metin })
  if (error) throw rpcHatasi(error)
  return { ok: true, message: data }
}

// Siler (yalnız yazarı; yumuşak silme, abonelere UPDATE olarak gider)
export async function deleteDmMessage(id) {
  const { error } = await supabase.rpc('delete_dm_message', { id })
  if (error) throw rpcHatasi(error)
}

// ---------- Tepki, sabitleme, yanıt alıntısı (messages.js karşılıkları) ----------

// Tepki ekler/kaldırır. Engelde eklenemez (hata metni engeli ele vermez: "Bunu yapamazsın.").
export async function reactDmMessage(mid, emoji, ekle) {
  const { error } = await supabase.rpc('react_dm_message', { mid, tepki: emoji, ekle: !!ekle })
  if (error) throw etkilesimHatasi(error)
}

// Sabitler/kaldırır (iki taraf da). Sabitleyince sohbete "… bir mesajı sabitledi." satırı düşer.
export async function pinDmMessage(mid, sabitle) {
  const { error } = await supabase.rpc('pin_dm_message', { mid, sabitle: !!sabitle })
  if (error) throw etkilesimHatasi(error)
}

export async function fetchPinnedDmMessages(threadId) {
  const { data, error } = await supabase
    .from('dm_message_pins')
    .select('pinned_at, pinned_by, message:dm_messages(*)')
    .eq('thread_id', threadId)
    .order('pinned_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return sabitSatirlari(data)
}

// Yanıt alıntısı için (silinmişler de gelir)
export async function fetchDmMessagesByIds(ids) {
  if (!ids?.length) return []
  const { data, error } = await supabase
    .from('dm_messages').select('id, thread_id, author_id, content, created_at, deleted_at, kind').in('id', ids)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Tek konuşmanın aboneliği (açık DM ekranı için; kanal aboneliğinin aynısı).
// Bağlantı kopup yeniden kurulunca getLastId()'den sonrası geri doldurulur, onReconnect() çağrılır.
let konusmaSayaci = 0
export function subscribeDmMessages(threadId, onInsert, { onUpdate, getLastId, onReconnect } = {}) {
  let kapandi = false
  let baglanmaSayisi = 0

  async function geriDoldur() {
    let son = getLastId?.()
    for (let sayfa = 0; son != null && sayfa < 20 && !kapandi; sayfa++) {
      const gelen = await fetchDmMessages(threadId, { after: son, limit: SAYFA })
      if (kapandi) return
      for (const m of gelen) onInsert(m)
      if (gelen.length < SAYFA) return
      son = gelen.at(-1).id
    }
  }

  const suzgec = { schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${threadId}` }
  const kanal = supabase
    .channel(`dm-messages:${threadId}:${++konusmaSayaci}`)
    .on('postgres_changes', { event: 'INSERT', ...suzgec }, (olay) => { if (!kapandi) onInsert(olay.new) })
  if (onUpdate) {
    kanal.on('postgres_changes', { event: 'UPDATE', ...suzgec }, (olay) => { if (!kapandi) onUpdate(olay.new) })
  }
  kanal.subscribe((durum) => {
    if (durum !== 'SUBSCRIBED' || kapandi) return
    baglanmaSayisi++
    if (baglanmaSayisi > 1) {
      geriDoldur().catch(() => { /* bir sonraki bağlanışta yine denenir */ })
      onReconnect?.()
    }
  })
  return () => { kapandi = true; supabase.removeChannel(kanal) }
}

// Bütün DM'lerimin mesajlarını TEK abonelikle dinler (okunmamış sayacı ve bildirimler için):
// süzgeç yok, RLS süzer. onInsert(mesaj), onUpdate(mesaj: düzenleme/silme), onReconnect()
// (2. ve sonraki SUBSCRIBED: sayılar fetchDmList ile yeniden alınmalı). Dönen fonksiyon kapatır.
let tumSayaci = 0
export function subscribeAllDmMessages({ onInsert, onUpdate, onReconnect } = {}) {
  let kapandi = false
  let baglanmaSayisi = 0
  const tablo = { schema: 'public', table: 'dm_messages' }
  const kanal = supabase
    .channel(`dm-messages-all:${++tumSayaci}`)
    .on('postgres_changes', { event: 'INSERT', ...tablo }, (olay) => { if (!kapandi) onInsert?.(olay.new) })
    .on('postgres_changes', { event: 'UPDATE', ...tablo }, (olay) => { if (!kapandi) onUpdate?.(olay.new) })
  kanal.subscribe((durum) => {
    if (durum !== 'SUBSCRIBED' || kapandi) return
    baglanmaSayisi++
    if (baglanmaSayisi > 1) onReconnect?.()
  })
  return () => { kapandi = true; supabase.removeChannel(kanal) }
}

// ---------- Okundu işareti ----------
// reads.js'teki markRead kalıbı: 1 sn birleştirmeli, yalnız ileri, başarısızsa yeniden denenir.
const dmOkuma = createReadMarker('mark_dm_read', (tid, mid) => ({ tid, mid }))

export function markDmRead(threadId, messageId) { dmOkuma.mark(threadId, messageId) }
export function flushDmReads() { return dmOkuma.flush() }
// (test için) durumu sıfırlar
export function resetDmReads() { dmOkuma.reset() }

// Arama kaydı satırı mı ("📞 Cevapsız arama" / "📞 Arama · 12:34"; yalnız sunucu yazar)?
export const aramaSatiri = (msg) => msg?.kind === 'call'
// Sistem satırı mı (arama kaydı ya da "… bir mesajı sabitledi."; yalnız sunucu yazar)?
// Düzenlenemez, silinemez; tepki, yanıt ve sabitleme almaz.
export const sistemSatiri = (msg) => msg?.kind === 'call' || msg?.kind === 'pin'

// ---------- chatView kaynağı ----------
// thread: fetchDmList()'ten gelen konuşma (id + other.username) ya da en az { id, other: { username } }.
// selfProfile: giriş yapan kişinin profili ({ id, username }).
// Dönen nesne kanal kaynağıyla aynı arayüzü sağlar (Task 3: mountChat({ source })):
//  { kind:'dm', id, title, placeholder, other, canSend, fetch(beforeId, { after, limit }), send(content), edit(id, content),
//    remove(id), subscribe({ onInsert, onUpdate, getLastId, onReconnect }) -> kapat,
//    joinTyping({ selfId, selfName, onChange }), markRead(id), canDelete(msg), canEdit(msg),
//    react(id, emoji, ekle), pin(id, sabitle), fetchPinned(), fetchByIds(ids), canReact(msg), canPin(msg),
//    ekKlasoru, sendWithAttachments(content, ekler, { replyTo }), fetchAttachments(ids), removeFiles(yollar) }
export function dmSource(thread, selfProfile) {
  const id = thread.id
  const ad = thread.other?.username ?? ''
  const yazabilir = thread.canSend !== false
  return {
    kind: 'dm',
    id,
    title: ad,
    placeholder: `@${ad} kişisine mesaj gönder`,
    other: thread.other ?? null,
    // Engel varsa (dm_list can_send=false) yazı kutusu kapanır; eski mesajlar görünür kalır
    canSend: yazabilir,
    fetch: (beforeId, { after, limit } = {}) => fetchDmMessages(id, { before: beforeId ?? undefined, after, limit }),
    send: (content, { replyTo } = {}) => sendDmMessage(id, content, selfProfile.id, { replyTo }),
    // Ekler (010): depo klasörü d/<konuşma>; engelde yükleme ve gönderme sunucuda da reddedilir
    ekKlasoru: `d/${id}`,
    sendWithAttachments: (content, ekler, { replyTo } = {}) => sendDmWithAttachments(id, content, ekler, { replyTo }, DM_EK_OZEL),
    fetchAttachments: (ids) => fetchAttachments('dm', ids),
    removeFiles: (yollar) => removeFiles(yollar),
    react: (mesajId, emoji, ekle) => reactDmMessage(mesajId, emoji, ekle),
    pin: (mesajId, sabitle) => pinDmMessage(mesajId, sabitle),
    fetchPinned: () => fetchPinnedDmMessages(id),
    fetchByIds: (ids) => fetchDmMessagesByIds(ids),
    // İki taraf da tepki verir ve sabitler; engelde (canSend false) ikisi de kapalı. Sistem satırına olmaz.
    canReact: (msg) => yazabilir && !!msg && !msg.deleted_at && !sistemSatiri(msg),
    canPin: (msg) => yazabilir && !!msg && !msg.deleted_at && !sistemSatiri(msg),
    edit: (mesajId, content) => editDmMessage(mesajId, content),
    remove: (mesajId) => deleteDmMessage(mesajId),
    subscribe: ({ onInsert, onUpdate, getLastId, onReconnect } = {}) =>
      subscribeDmMessages(id, (m) => onInsert?.(m), { onUpdate, getLastId, onReconnect }),
    joinTyping: (opts = {}) => joinTyping(id, { ...opts, topic: `dm-typing:${id}` }),
    markRead: (mesajId) => markDmRead(id, mesajId),
    // DM'de sahip kavramı yok: yalnız kendi mesajın silinir. Arama kaydı satırı (kind 'call')
    // düzenlenemez ve silinemez (yazarı arayan olsa da).
    // Sabit satırı (kind 'pin') da aynı kurala uyar.
    canDelete: (msg) => msg?.author_id === selfProfile.id && !sistemSatiri(msg),
    canEdit: (msg) => msg?.author_id === selfProfile.id && !sistemSatiri(msg),
  }
}
