// Özel mesaj (DM): liste, açma, gizleme, mesajlar, tek abonelik, okundu işareti ve
// chatView'in kullandığı "kaynak" nesnesi (dmSource).
// Kurallar veritabanında (supabase/migrations/007_sosyal.sql): dm_messages yalnız iki tarafa açık;
// gönderme doğrudan INSERT (taraf + engel yok), düzenleme/silme RPC ile.
import { supabase } from '../lib/supabase.js'
import { MAX_UZUNLUK, SAYFA } from './messages.js'
import { createReadMarker } from './reads.js'
import { joinTyping } from './typing.js'
import { rpcHatasi } from './friends.js'

export const GONDEREMEZSIN = 'Bu kişiye mesaj gönderemezsin.'
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
// Silinmiş mesajlar (deleted_at dolu) hiç gelmez.
export async function fetchDmMessages(threadId, { before, after, limit = SAYFA } = {}) {
  let sorgu = supabase.from('dm_messages').select('*').eq('thread_id', threadId).is('deleted_at', null)
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
export async function sendDmMessage(threadId, content, authorId) {
  const metin = String(content ?? '').trim()
  if (metin.length === 0) return { ok: false, warning: '' }
  if (metin.length > MAX_UZUNLUK) return { ok: false, warning: 'Mesaj en fazla 2000 karakter olabilir' }
  const { data, error } = await supabase
    .from('dm_messages')
    .insert({ thread_id: threadId, author_id: authorId, content: metin })
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

// ---------- chatView kaynağı ----------
// thread: fetchDmList()'ten gelen konuşma (id + other.username) ya da en az { id, other: { username } }.
// selfProfile: giriş yapan kişinin profili ({ id, username }).
// Dönen nesne kanal kaynağıyla aynı arayüzü sağlar (Task 3: mountChat({ source })):
//  { kind:'dm', id, title, placeholder, other, canSend, fetch(beforeId, { after, limit }), send(content), edit(id, content),
//    remove(id), subscribe({ onInsert, onUpdate, getLastId, onReconnect }) -> kapat,
//    joinTyping({ selfId, selfName, onChange }), markRead(id), canDelete(msg) }
export function dmSource(thread, selfProfile) {
  const id = thread.id
  const ad = thread.other?.username ?? ''
  return {
    kind: 'dm',
    id,
    title: ad,
    placeholder: `@${ad} kişisine mesaj gönder`,
    other: thread.other ?? null,
    // Engel varsa (dm_list can_send=false) yazı kutusu kapanır; eski mesajlar görünür kalır
    canSend: thread.canSend !== false,
    fetch: (beforeId, { after, limit } = {}) => fetchDmMessages(id, { before: beforeId ?? undefined, after, limit }),
    send: (content) => sendDmMessage(id, content, selfProfile.id),
    edit: (mesajId, content) => editDmMessage(mesajId, content),
    remove: (mesajId) => deleteDmMessage(mesajId),
    subscribe: ({ onInsert, onUpdate, getLastId, onReconnect } = {}) =>
      subscribeDmMessages(id, (m) => onInsert?.(m), { onUpdate, getLastId, onReconnect }),
    joinTyping: (opts = {}) => joinTyping(id, { ...opts, topic: `dm-typing:${id}` }),
    markRead: (mesajId) => markDmRead(id, mesajId),
    // DM'de sahip kavramı yok: yalnız kendi mesajın silinir
    canDelete: (msg) => msg?.author_id === selfProfile.id,
  }
}
